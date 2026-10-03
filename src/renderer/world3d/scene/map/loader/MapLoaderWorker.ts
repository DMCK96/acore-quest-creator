// @ts-nocheck
import {
  Map,
  MAP_LAYER_SPLAT_X,
  MAP_LAYER_SPLAT_Y,
  MapArea,
  MapChunk,
  MapLayer,
} from '@wowserhq/format';
import {
  createTerrainIndexBuffer,
  createTerrainVertexBuffer,
  mergeTerrainLayerSplats,
} from './util.js';
import { MapAreaSpec, TerrainSpec } from './types.js';
import { AssetHost, loadAsset, normalizePath } from '../../asset.js';
import SceneWorker from '../../worker/SceneWorker.js';

type MapLoaderWorkerOptions = {
  host: AssetHost;
};

class MapLoaderWorker extends SceneWorker {
  #host: AssetHost;

  #maps = new globalThis.Map<string, Map>();

  initialize(options: MapLoaderWorkerOptions) {
    this.#host = options.host;
  }

  async loadMapSpec(mapPath: string) {
    const map = await this.#loadMap(mapPath);

    const spec = {
      availableAreas: map.availableAreas,
    };

    return spec;
  }

  async loadAreaSpec(mapPath: string, areaPath: string) {
    const map = await this.#loadMap(mapPath);

    const areaData = await loadAsset(this.#host, areaPath);
    const area = new MapArea(map.layerSplatDepth).load(areaData);

    const buffers = new Set<ArrayBuffer>();

    const areaTableIds = new Uint32Array(area.chunks.length);
    buffers.add(areaTableIds.buffer);

    const terrainSpecs: TerrainSpec[] = [];
    for (let i = 0; i < area.chunks.length; i++) {
      const chunk = area.chunks[i];

      areaTableIds[i] = chunk.areaId;

      if (chunk.layers.length === 0) {
        continue;
      }

      const terrainSpec = {
        position: chunk.position,
        geometry: this.#createTerrainGeometrySpec(chunk),
        material: this.#createTerrainMaterialSpec(chunk),
      };

      terrainSpecs.push(terrainSpec);

      buffers.add(terrainSpec.geometry.vertexBuffer);
      buffers.add(terrainSpec.geometry.indexBuffer);

      if (terrainSpec.material.splat) {
        buffers.add(terrainSpec.material.splat.data.buffer);
      }
    }

    const spec: MapAreaSpec = {
      terrain: terrainSpecs,
      areaTableIds,
      doodadDefs: area.doodadDefs.map((def) => ({
        id: def.id,
        name: def.name,
        position: def.position,
        rotation: def.rotation,
        scale: def.scale,
      })),
    };

    const transfer = [...buffers];

    return [spec, transfer];
  }

  async #loadMap(mapPath) {
    const refId = normalizePath(mapPath);

    const existingMap = this.#maps.get(refId);
    if (existingMap) {
      return existingMap;
    }

    const mapData = await loadAsset(this.#host, mapPath);
    const map = new Map().load(mapData);

    this.#maps.set(refId, map);

    return map;
  }

  #createTerrainGeometrySpec(chunk: MapChunk) {
    const { vertexBuffer, bounds } = createTerrainVertexBuffer(
      chunk.vertexHeights,
      chunk.vertexNormals,
    );
    const indexBuffer = createTerrainIndexBuffer(chunk.holes);

    return {
      bounds,
      vertexBuffer,
      indexBuffer,
    };
  }

  #createTerrainMaterialSpec(chunk: MapChunk) {
    const splat = this.#createTerrainSplatSpec(chunk.layers);
    const layers = chunk.layers.map((layer) => ({
      effectId: layer.effectId,
      texturePath: layer.texture,
    }));

    return {
      layers,
      splat,
    };
  }

  #createTerrainSplatSpec(layers: MapLayer[]) {
    // No splat (0 or 1 layer)

    if (layers.length <= 1) {
      return null;
    }

    // Single splat (2 layers)

    if (layers.length === 2) {
      return {
        width: MAP_LAYER_SPLAT_X,
        height: MAP_LAYER_SPLAT_Y,
        data: layers[1].splat,
        channels: 1,
      };
    }

    // Multiple splats (3+ layers)

    const layerSplats = layers.slice(1).map((layer) => layer.splat);
    const mergedSplat = mergeTerrainLayerSplats(layerSplats, MAP_LAYER_SPLAT_X, MAP_LAYER_SPLAT_Y);
    return {
      width: MAP_LAYER_SPLAT_X,
      height: MAP_LAYER_SPLAT_Y,
      data: mergedSplat,
      channels: 4,
    };
  }
}

export default MapLoaderWorker;
