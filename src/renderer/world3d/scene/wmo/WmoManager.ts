// @ts-nocheck
import * as THREE from 'three';
import TextureManager from '../texture/TextureManager.js';
import { AssetHost, normalizePath } from '../asset.js';
import WmoLoader from './loader/WmoLoader.js';
import { WmoGroupSpec, WmoMaterialSpec, WmoSpec } from './loader/types.js';
import { MapAreaSpec } from '../map/loader/types.js';
import { describeError, reportProblem } from '../diagnostics.js';
import MapLight from '../map/light/MapLight.js';
import WmoMaterial from './WmoMaterial.js';
import LiquidManager from '../map/liquid/LiquidManager.js';

/**
 * Buildings: the large placed models (a house, the Abbey, a city wall). Each is a root file of
 * materials and several group files of geometry, loaded in a worker and drawn as one mesh per group.
 * Lit by the map's light like the terrain, with a group's baked lighting (vertex colours) added to it
 * where the group has some (see WmoMaterial).
 */

/** What a batch without a texture shows: a plain grey */
const UNTEXTURED = (() => {
  const texture = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
})();

const MATERIAL_FLAG_UNLIT = 0x1;
const MATERIAL_FLAG_CLAMP_S = 0x40;
const MATERIAL_FLAG_CLAMP_T = 0x80;

type WmoResources = {
  path: string;
  spec: WmoSpec;
  geometries: THREE.BufferGeometry[];
  /** Its water, magma and slime, made once and shared by every placement */
  liquidGeometries: THREE.BufferGeometry[];
  /** Materials for groups with baked lighting, and for those without; made on first use */
  materials: { lit: Promise<THREE.Material[]> | null; baked: Promise<THREE.Material[]> | null };
};

type WmoManagerOptions = {
  host: AssetHost;
  textureManager: TextureManager;
  mapLight: MapLight;
  liquidManager: LiquidManager;
};

class WmoManager {
  #textureManager: TextureManager;
  #mapLight: MapLight;
  #liquidManager: LiquidManager;
  #loader: WmoLoader;

  #loaded = new globalThis.Map<string, WmoResources>();
  #loading = new globalThis.Map<string, Promise<WmoResources>>();
  #areas = new globalThis.Map<number, THREE.Group>();

  constructor(options: WmoManagerOptions) {
    this.#textureManager = options.textureManager;
    this.#mapLight = options.mapLight;
    this.#liquidManager = options.liquidManager;
    this.#loader = new WmoLoader({ host: options.host });
  }

  /** The buildings an area places, as a group; one that cannot be loaded is reported and left out. */
  async getArea(areaId: number, area: MapAreaSpec): Promise<THREE.Group> {
    const group = new THREE.Group();
    group.name = 'buildings';
    group.matrixAutoUpdate = false;

    const defs = area.objDefs ?? [];
    const results = await Promise.allSettled(defs.map((def) => this.#getInstance(def.name)));

    for (let i = 0; i < defs.length; i++) {
      const result = results[i];
      const def = defs[i];

      if (result.status === 'rejected') {
        reportProblem(
          `building:${def.name.toLowerCase()}`,
          `building ${def.name} could not be loaded: ${describeError(result.reason)}`,
        );
        continue;
      }

      const building = result.value;
      building.position.set(def.position[0], def.position[1], def.position[2]);
      building.quaternion.set(def.rotation[0], def.rotation[1], def.rotation[2], def.rotation[3]);
      building.userData.placement = def.id;
      group.add(building);
    }

    group.updateMatrixWorld(true);
    for (const object of group.children) {
      object.matrixAutoUpdate = false;
    }

    this.#areas.set(areaId, group);

    return group;
  }

  /** Stops the loader's worker; the texture and liquid managers belong to the map */
  dispose() {
    this.#loader.dispose();
  }

  removeArea(areaId: number) {
    this.#areas.delete(areaId);
  }

  /** One placement of a building, outside any area (an object whose display is a building) */
  createInstance(path: string) {
    return this.#getInstance(path);
  }

  async #getInstance(path: string) {
    const resources = await this.#getResources(path);

    const [litMaterials, bakedMaterials] = await Promise.all([
      this.#getMaterials(resources, false),
      this.#getMaterials(resources, true),
    ]);

    const building = new THREE.Group();
    building.name = path;

    for (let i = 0; i < resources.geometries.length; i++) {
      const hasColors = resources.spec.groups[i].colors !== null;
      const mesh = new THREE.Mesh(
        resources.geometries[i],
        hasColors ? bakedMaterials : litMaterials,
      );
      mesh.matrixAutoUpdate = false;
      building.add(mesh);
    }

    // Canals, fountains, a harbour: water that cannot be drawn leaves the building standing
    const liquids = await Promise.allSettled(
      resources.spec.liquids.map((spec, i) => this.#liquidManager.createMesh(spec, resources.liquidGeometries[i])),
    );
    for (const liquid of liquids) {
      if (liquid.status === 'fulfilled') {
        liquid.value.matrixAutoUpdate = false;
        building.add(liquid.value);
      } else {
        console.warn(`3D view: the water of building ${path} could not be drawn: ${describeError(liquid.reason)}`);
      }
    }

    return building;
  }

  #getResources(path: string) {
    const refId = normalizePath(path);

    const loaded = this.#loaded.get(refId);
    if (loaded) {
      return Promise.resolve(loaded);
    }

    const alreadyLoading = this.#loading.get(refId);
    if (alreadyLoading) {
      return alreadyLoading;
    }

    const loading = this.#loadResources(refId, path).catch((error) => {
      // Not remembered, so a later area may try again; the caller reports it
      this.#loading.delete(refId);
      throw error;
    });
    this.#loading.set(refId, loading);

    return loading;
  }

  async #loadResources(refId: string, path: string) {
    const spec = await this.#loader.loadSpec(path);

    for (const problem of spec.problems) {
      reportProblem(`building-part:${problem}`, `part of building ${path} could not be loaded: ${problem}`);
    }

    const resources: WmoResources = {
      path,
      spec,
      geometries: spec.groups.map((group) => this.#createGeometry(group)),
      liquidGeometries: (spec.liquids ?? []).map((liquid) => this.#liquidManager.createGeometry(liquid)),
      materials: { lit: null, baked: null },
    };

    this.#loaded.set(refId, resources);
    this.#loading.delete(refId);

    return resources;
  }

  #createGeometry(group: WmoGroupSpec) {
    const vertexCount = group.positions.length / 3;
    const geometry = new THREE.BufferGeometry();

    geometry.setAttribute('position', new THREE.BufferAttribute(group.positions, 3));
    geometry.setAttribute(
      'uv',
      new THREE.BufferAttribute(group.uvs ?? new Float32Array(vertexCount * 2), 2),
    );
    if (group.normals) {
      geometry.setAttribute('normal', new THREE.BufferAttribute(group.normals, 3));
    }
    if (group.colors) {
      geometry.setAttribute('color', new THREE.BufferAttribute(group.colors, 4, true));
    }
    geometry.setIndex(new THREE.BufferAttribute(group.indices, 1));

    if (!group.normals) {
      geometry.computeVertexNormals();
    }

    // One draw per batch, each with its own material
    if (group.batches.length === 0) {
      geometry.addGroup(0, group.indices.length, 0);
    }
    for (const batch of group.batches) {
      geometry.addGroup(batch.start, batch.count, batch.material);
    }

    return geometry;
  }

  #getMaterials(resources: WmoResources, baked: boolean) {
    const key = baked ? 'baked' : 'lit';
    if (!resources.materials[key]) {
      resources.materials[key] = Promise.all(
        resources.spec.materials.map((spec) => this.#createMaterial(spec, baked, resources.path)),
      );
    }

    return resources.materials[key];
  }

  async #createMaterial(spec: WmoMaterialSpec, baked: boolean, building: string) {
    const texturePath = spec.textures[0];
    const map = texturePath
      ? await this.#textureManager.get(
          texturePath,
          spec.flags & MATERIAL_FLAG_CLAMP_S ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping,
          spec.flags & MATERIAL_FLAG_CLAMP_T ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping,
          undefined,
          undefined,
          `building ${building}`,
        )
      : UNTEXTURED;

    return new WmoMaterial({
      map,
      baked,
      unlit: (spec.flags & MATERIAL_FLAG_UNLIT) !== 0,
      blend: spec.blend,
      uniforms: this.#mapLight.uniforms,
    });
  }
}

export default WmoManager;
export { WmoManager };
