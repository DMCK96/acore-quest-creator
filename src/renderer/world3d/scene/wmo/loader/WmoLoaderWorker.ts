import { MapObj } from '../format/MapObj.js';
import { parseGroup, WmoGroupData } from '../format/group.js';
import { WmoGroupSpec, WmoSpec } from './types.js';
import SceneWorker from '../../worker/SceneWorker.js';
import { AssetHost, loadAsset } from '../../asset.js';
import { createBuildingLiquidSpec } from './liquid.js';
import type { LiquidSpec } from '../../map/loader/liquid.js';
import { mergeGroups } from './merge-groups.js';

/** How many yards across a building's merged meshes are, about: what a building is culled by when part of it is off screen */
const MESH_SIZE = 80;

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

type WmoLoaderWorkerOptions = {
  host: AssetHost;
};

class WmoLoaderWorker extends SceneWorker {
  #host!: AssetHost;

  initialize(options: WmoLoaderWorkerOptions) {
    this.#host = options.host;
  }

  /** A building: its root file (materials and the list of groups) and each group's geometry. */
  async loadSpec(path: string) {
    const rootData = await loadAsset(this.#host, path);
    const root = new MapObj().load(rootData);

    const basePath = path.replace(/\.wmo$/i, '');
    const problems: string[] = [];
    const liquids: LiquidSpec[] = [];

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
              problems.push(`${groupPath} water: ${messageOf(error)}`);
            }
          }
          return this.#createGroupSpec(group);
        } catch (error) {
          problems.push(`${groupPath}: ${messageOf(error)}`);
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
      // Fewer, larger meshes: a draw call for each material of each, not for each batch of each group
      groups: mergeGroups(groups.filter((group): group is WmoGroupSpec => group !== null && group.indices.length > 0), MESH_SIZE),
      liquids,
      problems,
      doodads: {
        sets: root.doodadSets.map(({ startIndex, count }) => ({ startIndex, count })),
        defs: root.doodadDefs,
      },
    };

    const transfer = new Set<ArrayBuffer>();
    for (const group of spec.groups) {
      // Each array is the worker's own copy (`Float32Array.from` and the like), never a shared buffer
      transfer.add(group.positions.buffer as ArrayBuffer);
      transfer.add(group.indices.buffer as ArrayBuffer);
      if (group.normals) transfer.add(group.normals.buffer as ArrayBuffer);
      if (group.uvs) transfer.add(group.uvs.buffer as ArrayBuffer);
      if (group.colors) transfer.add(group.colors.buffer as ArrayBuffer);
    }
    for (const liquid of liquids) {
      transfer.add(liquid.vertexBuffer);
      transfer.add(liquid.indexBuffer);
    }

    return [spec, [...transfer]];
  }

  #createGroupSpec(group: WmoGroupData): WmoGroupSpec | null {
    const vertices = group.vertices;
    if (!vertices || !group.indices) {
      return null;
    }

    // Own copies: the parsed arrays may be views into the file's buffer
    const positions = Float32Array.from(vertices);

    // Baked lighting is stored blue-green-red-alpha
    let colors: Uint8Array | null = null;
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
