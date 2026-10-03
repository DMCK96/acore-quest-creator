// @ts-nocheck
/**
 * Water, magma and slime on a map area: the ADT's MH2O chunk, read and turned into meshes.
 *
 * `@wowserhq/format` finds the chunk (MHDR's `mh2oOffset`) but does not read it, so it is read here.
 * The layout follows the WotLK structures in AzerothCore's map extractor
 * (src/tools/map_extractor/adt.h) and https://wowdev.wiki/ADT/v18#MH2O_chunk_(WotLK+). The way a
 * surface is laid out as a mesh (row along -X, column along -Y from the chunk's corner, two triangles
 * per filled tile) follows Adrinalin4ik/world-of-warcraft's `pipeline/liquid/layer.js` (MIT, see
 * ../liquid/LICENSE). Texture coordinates (world position × 0.06, or magma and slime's own × 3/256)
 * follow Kruithne/wow.export's `map-viewer/LiquidRenderer.js` (MIT). Both are listed in CREDITS.md at
 * the repository root.
 */
import { MAP_CHUNK_HEIGHT } from '@wowserhq/format';

/** Liquid tiles per chunk side; a chunk's liquid grid has one more vertex than that per side */
const LIQUID_TILES = 8;
const LIQUID_UNIT = MAP_CHUNK_HEIGHT / LIQUID_TILES;

/** How an instance's per-vertex data is laid out (LiquidMaterial.dbc's LVF) */
const LIQUID_VERTEX_FORMAT = {
  HEIGHT_DEPTH: 0,
  HEIGHT_UV: 1,
  DEPTH: 2,
} as const;

/** Floats per vertex in a liquid spec: x, y, z, u, v, depth (0 to 1) */
const LIQUID_VERTEX_STRIDE = 6;

/** Where a depth is not given (magma and slime's height-and-flow format): drawn as fully deep */
const NO_DEPTH = 255;

/** Texture coordinates where an instance has none of its own, per world unit (as wow.export does) */
const UV_PER_UNIT = 0.06;

/** Magma and slime's own texture coordinates are stored in 256ths of a third of a repeat */
const UV_DATA_SCALE = 3.0 / 256.0;

type LiquidInstance = {
  chunkIndex: number;
  liquidType: number;
  vertexFormat: number;
  minHeight: number;
  maxHeight: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  /** One per tile, row by row (width × height); 1 where the tile has liquid */
  exists: Uint8Array;
  /** One per vertex ((width + 1) × (height + 1)); null where the format has none */
  heights: Float32Array | null;
  depths: Uint8Array | null;
  /** Texture coordinates, two per vertex (magma and slime's flow); null where the format has none */
  uvs: Uint16Array | null;
};

/** The MH2O chunk's data as offsets into the area file, or null when the area has no liquid */
const findMh2o = (view: DataView) => {
  // MVER (12 bytes), then MHDR: its tag and size (8), then its data, which offsets are relative to
  const mhdrData = 20;
  if (view.byteLength < mhdrData + 44) {
    return null;
  }

  const mh2oOffset = view.getUint32(mhdrData + 40, true);
  if (mh2oOffset === 0) {
    return null;
  }

  const chunkStart = mhdrData + mh2oOffset;
  if (chunkStart + 8 > view.byteLength) {
    return null;
  }

  const size = view.getUint32(chunkStart + 4, true);
  const dataStart = chunkStart + 8;
  return { dataStart, dataEnd: Math.min(dataStart + size, view.byteLength) };
};

/** Every liquid instance (layer) of every chunk of an area file; empty when it has none */
const readLiquidInstances = (areaData: ArrayBuffer): LiquidInstance[] => {
  const view = new DataView(areaData);
  const found = findMh2o(view);
  if (!found) {
    return [];
  }

  const { dataStart: base, dataEnd } = found;
  const fits = (offset: number, length: number) => base + offset + length <= dataEnd;
  const instances: LiquidInstance[] = [];

  for (let chunkIndex = 0; chunkIndex < 256; chunkIndex++) {
    const headerAt = chunkIndex * 12;
    if (!fits(headerAt, 12)) {
      break;
    }

    const instancesOffset = view.getUint32(base + headerAt, true);
    const layerCount = view.getUint32(base + headerAt + 4, true);
    if (instancesOffset === 0 || layerCount === 0) {
      continue;
    }

    for (let layer = 0; layer < layerCount; layer++) {
      const at = instancesOffset + layer * 24;
      if (!fits(at, 24)) {
        break;
      }

      const p = base + at;
      const width = view.getUint8(p + 14);
      const height = view.getUint8(p + 15);
      const offsetX = view.getUint8(p + 12);
      const offsetY = view.getUint8(p + 13);
      if (width === 0 || height === 0 || offsetX + width > LIQUID_TILES || offsetY + height > LIQUID_TILES) {
        continue;
      }

      const vertexFormat = view.getUint16(p + 2, true);
      const existsOffset = view.getUint32(p + 16, true);
      const vertexDataOffset = view.getUint32(p + 20, true);
      const tileCount = width * height;
      const vertexCount = (width + 1) * (height + 1);

      // The bitmap is read bit by bit, low bit first, across each row in turn; no bitmap is all filled
      const exists = new Uint8Array(tileCount).fill(1);
      if (existsOffset !== 0 && fits(existsOffset, Math.ceil(tileCount / 8))) {
        for (let tile = 0; tile < tileCount; tile++) {
          const byte = view.getUint8(base + existsOffset + (tile >> 3));
          exists[tile] = (byte >> (tile & 7)) & 1;
        }
      }

      let heights: Float32Array | null = null;
      let depths: Uint8Array | null = null;
      let uvs: Uint16Array | null = null;

      if (vertexDataOffset !== 0) {
        const data = base + vertexDataOffset;
        const hasHeights = vertexFormat === LIQUID_VERTEX_FORMAT.HEIGHT_DEPTH || vertexFormat === LIQUID_VERTEX_FORMAT.HEIGHT_UV;

        if (hasHeights && fits(vertexDataOffset, vertexCount * 4)) {
          heights = new Float32Array(vertexCount);
          for (let i = 0; i < vertexCount; i++) {
            heights[i] = view.getFloat32(data + i * 4, true);
          }
        }

        const depthOffset =
          vertexFormat === LIQUID_VERTEX_FORMAT.HEIGHT_DEPTH ? vertexCount * 4 : vertexFormat === LIQUID_VERTEX_FORMAT.DEPTH ? 0 : -1;
        if (depthOffset >= 0 && fits(vertexDataOffset + depthOffset, vertexCount)) {
          depths = new Uint8Array(areaData.slice(data + depthOffset, data + depthOffset + vertexCount));
        }

        if (vertexFormat === LIQUID_VERTEX_FORMAT.HEIGHT_UV && fits(vertexDataOffset + vertexCount * 4, vertexCount * 4)) {
          uvs = new Uint16Array(vertexCount * 2);
          for (let i = 0; i < vertexCount * 2; i++) {
            uvs[i] = view.getUint16(data + vertexCount * 4 + i * 2, true);
          }
        }
      }

      instances.push({
        chunkIndex,
        liquidType: view.getUint16(p, true),
        vertexFormat,
        minHeight: view.getFloat32(p + 4, true),
        maxHeight: view.getFloat32(p + 8, true),
        offsetX,
        offsetY,
        width,
        height,
        exists,
        heights,
        depths,
        uvs,
      });
    }
  }

  return instances;
};

type LiquidSpec = {
  liquidType: number;
  /** Where the vertices are measured from: the area's first chunk corner */
  position: number[];
  /** LIQUID_VERTEX_STRIDE floats per vertex */
  vertexBuffer: ArrayBuffer;
  indexBuffer: ArrayBuffer;
  /** Indices are 32-bit (else 16-bit): an area with more than 65535 liquid vertices of one type */
  wideIndices: boolean;
  bounds: { extent: Float32Array };
};

/**
 * One mesh per liquid type in the area. Chunk positions are the corners MCNK gives (the same the
 * terrain is drawn from); vertices are kept relative to the first one so they stay precise as floats.
 */
const createLiquidSpecs = (instances: LiquidInstance[], chunkPositions: number[][]): LiquidSpec[] => {
  if (instances.length === 0 || chunkPositions.length === 0) {
    return [];
  }

  const origin = chunkPositions[0];
  const byType = new globalThis.Map<number, LiquidInstance[]>();
  for (const instance of instances) {
    if (!chunkPositions[instance.chunkIndex]) {
      continue;
    }
    const list = byType.get(instance.liquidType) ?? [];
    list.push(instance);
    byType.set(instance.liquidType, list);
  }

  const specs: LiquidSpec[] = [];

  for (const [liquidType, list] of byType) {
    let vertexTotal = 0;
    let indexTotal = 0;
    for (const instance of list) {
      vertexTotal += (instance.width + 1) * (instance.height + 1);
      indexTotal += instance.exists.reduce((sum, filled) => sum + filled, 0) * 6;
    }
    if (indexTotal === 0) {
      continue;
    }

    const vertices = new Float32Array(vertexTotal * LIQUID_VERTEX_STRIDE);
    const indices = vertexTotal > 0xffff ? new Uint32Array(indexTotal) : new Uint16Array(indexTotal);
    const extent = new Float32Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);

    let vertexBase = 0;
    let indexAt = 0;

    for (const instance of list) {
      const corner = chunkPositions[instance.chunkIndex];
      const perRow = instance.width + 1;
      const surface = Number.isFinite(instance.maxHeight) ? instance.maxHeight : instance.minHeight;

      for (let y = 0; y <= instance.height; y++) {
        for (let x = 0; x <= instance.width; x++) {
          const i = y * perRow + x;
          const row = instance.offsetY + y;
          const column = instance.offsetX + x;
          const o = (vertexBase + i) * LIQUID_VERTEX_STRIDE;

          const vx = corner[0] - origin[0] - row * LIQUID_UNIT;
          const vy = corner[1] - origin[1] - column * LIQUID_UNIT;
          const vz = (instance.heights ? instance.heights[i] : surface) - origin[2];

          vertices[o] = vx;
          vertices[o + 1] = vy;
          vertices[o + 2] = vz;
          // The instance's own (magma and slime's flow), else from where it is in the world, so the
          // texture runs on unbroken from one chunk and one area to the next
          if (instance.uvs) {
            vertices[o + 3] = instance.uvs[i * 2] * UV_DATA_SCALE;
            vertices[o + 4] = instance.uvs[i * 2 + 1] * UV_DATA_SCALE;
          } else {
            vertices[o + 3] = (vx + origin[0]) * UV_PER_UNIT;
            vertices[o + 4] = (vy + origin[1]) * UV_PER_UNIT;
          }
          vertices[o + 5] = (instance.depths ? instance.depths[i] : NO_DEPTH) / 255;

          extent[0] = Math.min(extent[0], vx);
          extent[1] = Math.min(extent[1], vy);
          extent[2] = Math.min(extent[2], vz);
          extent[3] = Math.max(extent[3], vx);
          extent[4] = Math.max(extent[4], vy);
          extent[5] = Math.max(extent[5], vz);
        }
      }

      for (let y = 0; y < instance.height; y++) {
        for (let x = 0; x < instance.width; x++) {
          if (!instance.exists[y * instance.width + x]) {
            continue;
          }
          const i = vertexBase + y * perRow + x;
          indices[indexAt++] = i;
          indices[indexAt++] = i + perRow;
          indices[indexAt++] = i + 1;
          indices[indexAt++] = i + 1;
          indices[indexAt++] = i + perRow;
          indices[indexAt++] = i + perRow + 1;
        }
      }

      vertexBase += (instance.width + 1) * (instance.height + 1);
    }

    specs.push({
      liquidType,
      position: [origin[0], origin[1], origin[2]],
      vertexBuffer: vertices.buffer,
      indexBuffer: indices.buffer,
      wideIndices: indices instanceof Uint32Array,
      bounds: { extent },
    });
  }

  return specs;
};

export {
  LIQUID_UNIT,
  LIQUID_VERTEX_FORMAT,
  LIQUID_VERTEX_STRIDE,
  UV_DATA_SCALE,
  UV_PER_UNIT,
  LiquidInstance,
  LiquidSpec,
  createLiquidSpecs,
  readLiquidInstances,
};
