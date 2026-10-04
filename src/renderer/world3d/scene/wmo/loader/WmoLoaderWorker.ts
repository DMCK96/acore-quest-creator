// @ts-nocheck
import { MapObj } from '../format/MapObj.js';
import { parseGroup, WmoGroupData } from '../format/group.js';
import { WmoGroupSpec, WmoSpec } from './types.js';
import SceneWorker from '../../worker/SceneWorker.js';
import { AssetHost, loadAsset } from '../../asset.js';
import { createBuildingLiquidSpec } from './liquid.js';

type WmoLoaderWorkerOptions = {
  host: AssetHost;
};

class WmoLoaderWorker extends SceneWorker {
  #host: AssetHost;

  initialize(options: WmoLoaderWorkerOptions) {
    this.#host = options.host;
  }

  /** A building: its root file (materials and the list of groups) and each group's geometry. */
  async loadSpec(path: string) {
    const rootData = await loadAsset(this.#host, path);
    const root = new MapObj().load(rootData);

    const basePath = path.replace(/\.wmo$/i, '');
    const problems: string[] = [];
    const liquids = [];

    // A group that is missing or broken is left out; the rest of the building still draws
    const groups = await Promise.all(
      root.groupInfo.map(async (_info, index) => {
        const groupPath = `${basePath}_${index.toString().padStart(3, '0')}.wmo`;
        try {
          const data = await loadAsset(this.#host, groupPath);
          const group = parseGroup(data, root.flags);
          // A group's water is kept apart from its walls: some groups are only water
          if (group.liquid) {
            try {
              const liquid = createBuildingLiquidSpec(group.liquid, root.flags);
              if (liquid) liquids.push(liquid);
            } catch (error) {
              problems.push(`${groupPath} water: ${error.message}`);
            }
          }
          return this.#createGroupSpec(group);
        } catch (error) {
          problems.push(`${groupPath}: ${error.message}`);
          return null;
        }
      }),
    );

    const spec: WmoSpec = {
      materials: root.materials.map((material) => ({
        flags: material.flags,
        blend: material.blend,
        textures: material.textures,
      })),
      groups: groups.filter((group) => group !== null && group.indices.length > 0),
      liquids,
      problems,
    };

    const transfer = new Set<ArrayBuffer>();
    for (const group of spec.groups) {
      transfer.add(group.positions.buffer);
      transfer.add(group.indices.buffer);
      if (group.normals) transfer.add(group.normals.buffer);
      if (group.uvs) transfer.add(group.uvs.buffer);
      if (group.colors) transfer.add(group.colors.buffer);
    }
    for (const liquid of liquids) {
      transfer.add(liquid.vertexBuffer);
      transfer.add(liquid.indexBuffer);
    }

    return [spec, [...transfer]];
  }

  #createGroupSpec(group: WmoGroupData): WmoGroupSpec {
    const vertices = group.vertices;
    if (!vertices || !group.indices) {
      return null;
    }

    // Own copies: the parsed arrays may be views into the file's buffer
    const positions = Float32Array.from(vertices);

    // Baked lighting is stored blue-green-red-alpha
    let colors: Uint8Array = null;
    if (group.colors && group.colors.length >= (positions.length / 3) * 4) {
      colors = new Uint8Array(group.colors.length);
      for (let i = 0; i + 3 < colors.length; i += 4) {
        colors[i] = group.colors[i + 2];
        colors[i + 1] = group.colors[i + 1];
        colors[i + 2] = group.colors[i];
        colors[i + 3] = 255;
      }
    }

    return {
      positions,
      normals: group.normals ? Float32Array.from(group.normals) : null,
      uvs: group.textureCoords ? Float32Array.from(group.textureCoords) : null,
      colors,
      indices: Uint16Array.from(group.indices),
      batches: group.batches.map((batch) => ({
        start: batch.indexStart,
        count: batch.indexCount,
        material: batch.materialIndex,
      })),
    };
  }
}

export default WmoLoaderWorker;
