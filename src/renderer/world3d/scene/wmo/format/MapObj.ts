// From @wowserhq/format 0.28.0 (MIT, Wowser Contributors); see ../../LICENSE.
import { IoMode, openStream, type IoSource, type IoStream } from '@wowserhq/io';
import { indexChunks } from '../util.js';
import * as rootIo from './io/root.js';
import * as commonIo from './io/common.js';
import {
  MAP_OBJ_FLAG,
  MAP_OBJ_GROUP_FLAG,
  MAP_OBJ_FRAGMENT_SHADER,
  MAP_OBJ_MATERIAL_FLAG,
  MAP_OBJ_SHADER,
  MAP_OBJ_VERTEX_SHADER,
} from './const.js';

type MapObjColor = { r: number; g: number; b: number; a: number };

/** One of the building's groups as its root file lists it */
type MapObjGroupInfo = { flags: number; boundingBox: number[]; name: string | undefined };

/** One of the building's materials */
type MapObjMaterial = {
  flags: number;
  /** How the material blends: 0 opaque, 1 alpha key, 2 alpha, 3 additive... */
  blend: number;
  vertexShader: MAP_OBJ_VERTEX_SHADER;
  fragmentShader: MAP_OBJ_FRAGMENT_SHADER;
  textures: string[];
  sidnColor: MapObjColor;
  diffuseColor: MapObjColor;
};

/** The root file's chunks as `io/root.ts` reads them */
type RootHeader = { ambientColor: MapObjColor; flags: number };
type RootGroupInfo = { flags: number; boundingBox: number[]; nameOffset: number };
type RootMaterial = {
  flags: number;
  shader: number;
  blend: number;
  texture1Offset: number;
  texture2Offset: number;
  sidnColor: MapObjColor;
  diffuseColor: MapObjColor;
};

/**
 * A string table of the root file (texture names, group names), to read names from by offset. A file
 * without the table gives no names: some custom buildings have materials but no texture table, and
 * opening a stream on the missing chunk failed the whole building ("Unknown source type").
 */
class StringTable {
  #stream: IoStream | null;

  constructor(chunk: unknown) {
    this.#stream = chunk ? openStream(chunk as IoSource, IoMode.Read) : null;
  }

  at(offset: number): string | undefined {
    if (!this.#stream) return undefined;
    this.#stream.offset = offset;
    return commonIo.mapObjString.read(this.#stream);
  }

  close(): void {
    this.#stream?.close();
  }
}

class MapObj {
  #version = 17;
  #flags = 0x0;
  #ambientColor: MapObjColor = { r: 127, g: 127, b: 127, a: 255 };
  #groupInfo: MapObjGroupInfo[] = [];
  #materials: MapObjMaterial[] = [];
  get ambientColor() {
    return this.#ambientColor;
  }
  get flags() {
    return this.#flags;
  }
  get groupInfo() {
    return this.#groupInfo;
  }
  get materials() {
    return this.#materials;
  }
  get version() {
    return this.#version;
  }
  load(source: IoSource) {
    const stream = openStream(source, IoMode.Read);
    const chunks = rootIo.root.read(stream) as { tag: string; value: unknown }[];
    stream.close();
    const data = indexChunks(chunks);
    const versionChunk = data.get('MVER') as { version: number } | undefined;
    if (versionChunk) {
      if (versionChunk.version !== 17) {
        throw new Error(`Unsupported WMO version: ${versionChunk.version}`);
      }
      this.#version = versionChunk.version;
    }
    const headerChunk = data.get('MOHD') as RootHeader | undefined;
    if (headerChunk) {
      this.#ambientColor = headerChunk.ambientColor;
      this.#flags = headerChunk.flags;
    }
    this.#loadGroupInfo((data.get('MOGI') as RootGroupInfo[] | undefined) ?? [], data);
    this.#loadMaterials((data.get('MOMT') as RootMaterial[] | undefined) ?? [], data);
    return this;
  }
  #loadGroupInfo(groupInfos: RootGroupInfo[], rootData: Map<string, unknown>) {
    const names = new StringTable(rootData.get('MOGN'));
    for (const groupInfo of groupInfos) {
      this.#groupInfo.push({
        flags: groupInfo.flags,
        boundingBox: groupInfo.boundingBox,
        name: groupInfo.nameOffset >= 0 ? names.at(groupInfo.nameOffset) : undefined,
      });
    }
    names.close();
  }
  #loadMaterials(materials: RootMaterial[], rootData: Map<string, unknown>) {
    const names = new StringTable(rootData.get('MOTX'));
    for (const material of materials) {
      const textures: string[] = [];
      const texture1 = names.at(material.texture1Offset);
      if (texture1) {
        textures.push(texture1);
      }
      const texture2 = names.at(material.texture2Offset);
      if (texture2) {
        textures.push(texture2);
      }
      const shader = MAP_OBJ_SHADER[material.shader];
      this.#materials.push({
        flags: material.flags,
        // Dropped by the published parser: how the material blends (0 opaque, 1 alpha key, 2 alpha, 3 additive...)
        blend: material.blend,
        ...shader,
        textures,
        sidnColor: material.sidnColor,
        diffuseColor: material.diffuseColor,
      });
    }
    names.close();
  }
}
export default MapObj;
export type { MapObjGroupInfo, MapObjMaterial };
export { MapObj, MAP_OBJ_FLAG, MAP_OBJ_GROUP_FLAG, MAP_OBJ_MATERIAL_FLAG, MAP_OBJ_FRAGMENT_SHADER, MAP_OBJ_VERTEX_SHADER };
