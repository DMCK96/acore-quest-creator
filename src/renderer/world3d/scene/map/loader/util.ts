// @ts-nocheck
import { MAP_CHUNK_FACE_COUNT_X, MAP_CHUNK_FACE_COUNT_Y } from '@wowserhq/format';
import { DEFAULT_TERRAIN_VERTEX_BUFFER } from './const.js';

const getBoundsCenter = (extent: Float32Array) => {
  const center = new Float32Array(3);

  center[0] = (extent[0] + extent[3]) * 0.5;
  center[1] = (extent[1] + extent[4]) * 0.5;
  center[2] = (extent[2] + extent[5]) * 0.5;

  return center;
};

const getBoundsRadius = (extent: Float32Array, center: Float32Array) => {
  const x = extent[3] - center[0];
  const y = extent[4] - center[1];
  const z = extent[5] - center[2];

  return Math.sqrt(x * x + y * y + z * z);
};

const isTerrainHole = (holes: number, x: number, y: number) => {
  const column = (y / 2) | 0;
  const row = (x / 2) | 0;
  const hole = 1 << (column * 4 + row);

  return (hole & holes) !== 0;
};

const createTerrainVertexBuffer = (vertexHeights: Float32Array, vertexNormals: Int8Array) => {
  // Copy the default vertex buffer (contains x and y coordinates)
  const data = DEFAULT_TERRAIN_VERTEX_BUFFER.slice(0);
  const view = new DataView(data);

  let minZ = +Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < vertexHeights.length; i++) {
    const vertexOfs = i * 16;
    const vertexHeight = vertexHeights[i];

    // Track bounds (z)
    minZ = Math.min(minZ, vertexHeight);
    maxZ = Math.max(maxZ, vertexHeight);

    // Position (z)
    view.setFloat32(vertexOfs + 8, vertexHeight, true);

    // Normal
    const normalOfs = i * 3;
    view.setInt8(vertexOfs + 12, vertexNormals[normalOfs + 0]);
    view.setInt8(vertexOfs + 13, vertexNormals[normalOfs + 1]);
    view.setInt8(vertexOfs + 14, vertexNormals[normalOfs + 2]);
  }

  const minX = view.getFloat32(data.byteLength - 16, true);
  const minY = view.getFloat32(data.byteLength - 12, true);
  const maxX = view.getFloat32(0, true);
  const maxY = view.getFloat32(4, true);

  const extent = new Float32Array([minX, minY, minZ, maxX, maxY, maxZ]);
  const center = getBoundsCenter(extent);
  const radius = getBoundsRadius(extent, center);

  return {
    bounds: { extent, center, radius },
    vertexBuffer: data,
  };
};

const createTerrainIndexBuffer = (holes: number) => {
  const data = new ArrayBuffer(MAP_CHUNK_FACE_COUNT_X * MAP_CHUNK_FACE_COUNT_Y * 3 * 4 * 2);
  const view = new DataView(data);

  let i = 0;

  for (let x = 0; x < MAP_CHUNK_FACE_COUNT_X; x++) {
    for (let y = 0; y < MAP_CHUNK_FACE_COUNT_Y; y++) {
      if (isTerrainHole(holes, x, y)) {
        continue;
      }

      const f = x * 17 + y + 9;

      view.setUint16(i * 24 + 0, f, true);
      view.setUint16(i * 24 + 2, f - 9, true);
      view.setUint16(i * 24 + 4, f + 8, true);

      view.setUint16(i * 24 + 6, f, true);
      view.setUint16(i * 24 + 8, f - 8, true);
      view.setUint16(i * 24 + 10, f - 9, true);

      view.setUint16(i * 24 + 12, f, true);
      view.setUint16(i * 24 + 14, f + 9, true);
      view.setUint16(i * 24 + 16, f - 8, true);

      view.setUint16(i * 24 + 18, f, true);
      view.setUint16(i * 24 + 20, f + 8, true);
      view.setUint16(i * 24 + 22, f + 9, true);

      i++;
    }
  }

  return data;
};

const mergeTerrainLayerSplats = (layerSplats: Uint8Array[], width: number, height: number) => {
  const data = new Uint8Array(width * height * 4);

  // Treat each layer splat as a separate color channel
  for (let l = 0; l < layerSplats.length; l++) {
    const layerSplat = layerSplats[l];

    for (let i = 0; i < width * height; i++) {
      data[i * 4 + l] = layerSplat[i];
    }
  }

  return data;
};

export { createTerrainIndexBuffer, createTerrainVertexBuffer, mergeTerrainLayerSplats };
