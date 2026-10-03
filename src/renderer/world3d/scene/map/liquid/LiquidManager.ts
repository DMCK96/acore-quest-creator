// @ts-nocheck
/**
 * Water, magma and slime on the map's areas: one mesh per liquid type per area, sharing one material
 * per type. Types come from LiquidType.dbc, so a client's own types (CoA has several) draw as it
 * defines them. Inspired by Adrinalin4ik/world-of-warcraft's `pipeline/liquid` (MIT, see LICENSE here
 * and CREDITS.md at the repository root).
 */
import * as THREE from 'three';
import DbManager from '../../db/DbManager.js';
import LiquidTypeRecord from '../../db/LiquidTypeRecord.js';
import TextureManager from '../../texture/TextureManager.js';
import MapLight from '../light/MapLight.js';
import { LIQUID_VERTEX_STRIDE, LiquidSpec } from '../loader/liquid.js';
import { MapAreaSpec } from '../loader/types.js';
import LiquidMaterial, { LIQUID_KIND, LiquidTypeInfo } from './LiquidMaterial.js';

type LiquidManagerOptions = {
  textureManager: TextureManager;
  dbManager: DbManager;
  mapLight: MapLight;
};

/** Where the client has no such liquid type: drawn as plain water */
const FALLBACK_TYPE: LiquidTypeInfo = {
  kind: LIQUID_KIND.WATER,
  materialId: 1,
  texturePattern: 'XTextures\\river\\lake_a.%d.blp',
  floats: [1, 0],
};

/** What the material shows until its first frame arrives */
const PLACEHOLDER = (() => {
  const texture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
})();

class LiquidManager {
  #textureManager: TextureManager;
  #dbManager: DbManager;
  #mapLight: MapLight;

  #types: Promise<Map<number, LiquidTypeInfo>>;
  #materials = new globalThis.Map<number, Promise<LiquidMaterial>>();
  #loadedMaterials = new Set<LiquidMaterial>();
  #areas = new globalThis.Map<number, THREE.Group>();

  constructor(options: LiquidManagerOptions) {
    this.#textureManager = options.textureManager;
    this.#dbManager = options.dbManager;
    this.#mapLight = options.mapLight;
  }

  async getArea(areaId: number, area: MapAreaSpec): Promise<THREE.Group> {
    const group = new THREE.Group();
    group.name = 'liquid';
    // As the terrain: the map's root does not update matrices; each mesh sets its own once
    group.matrixAutoUpdate = false;
    group.matrixWorldAutoUpdate = false;

    for (const spec of area.liquids ?? []) {
      group.add(await this.createMesh(spec));
    }

    this.#areas.set(areaId, group);
    return group;
  }

  removeArea(areaId: number) {
    const group = this.#areas.get(areaId);
    if (!group) {
      return;
    }

    // Materials are shared between areas and kept; only the geometry goes
    for (const mesh of group.children) {
      (mesh as THREE.Mesh).geometry.dispose();
    }

    this.#areas.delete(areaId);
  }

  /** Advances every liquid's flipbook and flow; `deltaTime` in seconds */
  #dbgTime = 0;
  update(deltaTime: number) {
    for (const material of this.#loadedMaterials) {
      material.update(deltaTime);
    }
  }

  dispose() {
    for (const areaId of [...this.#areas.keys()]) {
      this.removeArea(areaId);
    }
    for (const material of this.#loadedMaterials) {
      material.dispose();
    }
    this.#loadedMaterials.clear();
    this.#materials.clear();
  }

  /** A liquid's mesh, at its spec's position, with the shared material for its type */
  async createMesh(spec: LiquidSpec, geometry = this.createGeometry(spec)) {
    const material = await this.#getMaterial(spec.liquidType);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `liquid:${spec.liquidType}`;
    mesh.position.set(spec.position[0], spec.position[1], spec.position[2]);
    // See-through surfaces are drawn after the solid world, so what is under them shows
    mesh.renderOrder = material.transparent ? 1 : 0;
    // Its own world matrix: the terrain's liquid group does not update them (a building redoes it)
    mesh.updateMatrixWorld();
    return mesh;
  }

  /** A liquid's geometry alone, for a caller that keeps and shares it (a building's water) */
  createGeometry(spec: LiquidSpec) {
    const geometry = new THREE.BufferGeometry();

    const vertices = new THREE.InterleavedBuffer(new Float32Array(spec.vertexBuffer), LIQUID_VERTEX_STRIDE);
    geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(vertices, 3, 0, false));
    geometry.setAttribute('uv', new THREE.InterleavedBufferAttribute(vertices, 2, 3, false));
    geometry.setAttribute('depth', new THREE.InterleavedBufferAttribute(vertices, 1, 5, false));

    const indices = spec.wideIndices ? new Uint32Array(spec.indexBuffer) : new Uint16Array(spec.indexBuffer);
    geometry.setIndex(new THREE.BufferAttribute(indices, 1, false));

    geometry.boundingBox = new THREE.Box3().setFromArray(spec.bounds.extent);
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());

    return geometry;
  }

  #getMaterial(liquidType: number) {
    let material = this.#materials.get(liquidType);
    if (!material) {
      material = this.#createMaterial(liquidType);
      this.#materials.set(liquidType, material);
    }
    return material;
  }

  async #createMaterial(liquidType: number) {
    const types = await this.#getTypes();
    const info = types.get(liquidType) ?? FALLBACK_TYPE;
    const uniforms = { ...this.#mapLight.uniforms, ...this.#mapLight.waterUniforms };
    const material = new LiquidMaterial(info, (path) => this.#textureManager.getOptional(path), uniforms, PLACEHOLDER);
    this.#loadedMaterials.add(material);
    return material;
  }

  #getTypes() {
    if (!this.#types) {
      this.#types = this.#dbManager
        .get('LiquidType.dbc', LiquidTypeRecord)
        .then((db) => {
          const types = new globalThis.Map<number, LiquidTypeInfo>();
          for (const record of db.records ?? []) {
            types.set(record.id, {
              kind: record.soundBank,
              materialId: record.materialId,
              texturePattern: record.textures[0],
              floats: record.floats,
            });
          }
          return types;
        })
        .catch((error) => {
          console.warn(`3D view: LiquidType.dbc could not be read, so every liquid is drawn as water: ${error}`);
          return new globalThis.Map();
        });
    }
    return this.#types;
  }
}

export default LiquidManager;
export { LiquidManager };
