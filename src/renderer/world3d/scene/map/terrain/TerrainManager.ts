// @ts-nocheck
import * as THREE from 'three';
import TextureManager from '../../texture/TextureManager.js';
import TerrainMaterial from './TerrainMaterial.js';
import TerrainMesh from './TerrainMesh.js';
import { AssetHost } from '../../asset.js';
import { MapAreaSpec, TerrainSpec } from '../loader/types.js';
import MapLight from '../light/MapLight.js';

const SPLAT_TEXTURE_PLACEHOLDER = new THREE.Texture();

type TerrainManagerOptions = {
  host: AssetHost;
  textureManager?: TextureManager;
  mapLight: MapLight;
};

class TerrainManager {
  #textureManager: TextureManager;
  #mapLight: MapLight;

  #loadedAreas = new globalThis.Map<number, THREE.Group>();
  #loadingAreas = new globalThis.Map<number, Promise<THREE.Group>>();

  constructor(options: TerrainManagerOptions) {
    this.#textureManager = options.textureManager ?? new TextureManager({ host: options.host });
    this.#mapLight = options.mapLight;
  }

  getArea(areaId: number, area: MapAreaSpec): Promise<THREE.Group> {
    const loaded = this.#loadedAreas.get(areaId);
    if (loaded) {
      return Promise.resolve(loaded);
    }

    const alreadyLoading = this.#loadingAreas.get(areaId);
    if (alreadyLoading) {
      return alreadyLoading;
    }

    const loading = this.#loadArea(areaId, area);
    this.#loadingAreas.set(areaId, loading);

    return loading;
  }

  removeArea(areaId: number) {
    const group = this.#loadedAreas.get(areaId);
    if (!group) {
      return;
    }

    for (const mesh of group.children) {
      (mesh as TerrainMesh).dispose();
    }

    this.#loadedAreas.delete(areaId);
  }

  async #loadArea(areaId: number, area: MapAreaSpec) {
    const group = new THREE.Group();
    group.name = 'terrain';
    group.matrixAutoUpdate = false;
    group.matrixWorldAutoUpdate = false;

    const meshes = await Promise.all(area.terrain.map((terrain) => this.#createMesh(terrain)));

    for (const mesh of meshes) {
      group.add(mesh);
    }

    this.#loadedAreas.set(areaId, group);
    this.#loadingAreas.delete(areaId);

    return group;
  }

  async #createMesh(spec: TerrainSpec) {
    const geometry = this.#createGeometry(spec);
    const material = await this.#createMaterial(spec);

    return new TerrainMesh(spec.position, geometry, material);
  }

  #createGeometry(spec: TerrainSpec) {
    const vertexBuffer = spec.geometry.vertexBuffer;
    const indexBuffer = spec.geometry.indexBuffer;

    const geometry = new THREE.BufferGeometry();

    // Vertex Buffer

    const positions = new THREE.InterleavedBuffer(new Float32Array(vertexBuffer), 4);
    geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(positions, 3, 0, false));

    const normals = new THREE.InterleavedBuffer(new Int8Array(vertexBuffer), 16);
    geometry.setAttribute('normal', new THREE.InterleavedBufferAttribute(normals, 4, 12, true));

    // Index Buffer

    const index = new THREE.BufferAttribute(new Uint16Array(indexBuffer), 1, false);
    geometry.setIndex(index);

    // Bounds

    const bounds = spec.geometry.bounds;

    geometry.boundingBox = new THREE.Box3().setFromArray(bounds.extent);

    const boundsCenter = new THREE.Vector3(bounds.center[0], bounds.center[1], bounds.center[2]);
    geometry.boundingSphere = new THREE.Sphere(boundsCenter, bounds.radius);

    return geometry;
  }

  async #createMaterial(spec: TerrainSpec) {
    const splatTexture = this.#createSplatTexture(spec);
    const layerTextures = await Promise.all(
      spec.material.layers.map((layer) => this.#textureManager.get(layer.texturePath)),
    );
    const uniforms = { ...this.#mapLight.uniforms };

    return new TerrainMaterial(spec.material.layers.length, layerTextures, splatTexture, uniforms);
  }

  #createSplatTexture(spec: TerrainSpec) {
    const splat = spec.material.splat;

    // No splat (0 or 1 layer)

    if (!splat) {
      // Return placeholder texture to keep uniforms consistent
      return SPLAT_TEXTURE_PLACEHOLDER;
    }

    // Single splat (2 layers)

    if (splat.channels === 1) {
      const texture = new THREE.DataTexture(splat.data, splat.width, splat.height, THREE.RedFormat);
      texture.minFilter = texture.magFilter = THREE.LinearFilter;
      texture.anisotropy = 16;
      texture.needsUpdate = true;

      return texture;
    }

    // Multiple splats (3+ layers)

    const texture = new THREE.DataTexture(splat.data, splat.width, splat.height, THREE.RGBAFormat);
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = 16;
    texture.needsUpdate = true;

    return texture;
  }
}

export default TerrainManager;
export { TerrainManager };
