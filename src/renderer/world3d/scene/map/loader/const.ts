// @ts-nocheck
import {
  MAP_CHUNK_FACE_COUNT_X,
  MAP_CHUNK_FACE_COUNT_Y,
  MAP_CHUNK_HEIGHT,
  MAP_CHUNK_VERTEX_COUNT,
  MAP_CHUNK_VERTEX_STEP_X,
  MAP_CHUNK_VERTEX_STEP_Y,
  MAP_CHUNK_WIDTH,
} from '@wowserhq/format';

const DEFAULT_TERRAIN_VERTEX_BUFFER = (() => {
  // Vertex coordinates for x-axis (forward axis)
  const vxe = new Float32Array(MAP_CHUNK_FACE_COUNT_X + 1);
  const vxo = new Float32Array(MAP_CHUNK_FACE_COUNT_X);
  for (let i = 0; i < MAP_CHUNK_FACE_COUNT_X; i++) {
    const vx = -(i * MAP_CHUNK_VERTEX_STEP_X);
    vxe[i] = vx;
    vxo[i] = vx - MAP_CHUNK_VERTEX_STEP_X / 2.0;
  }
  vxe[MAP_CHUNK_FACE_COUNT_X] = -MAP_CHUNK_HEIGHT;

  // Vertex coordinates for y-axis (right axis)
  const vye = new Float32Array(MAP_CHUNK_FACE_COUNT_Y + 1);
  const vyo = new Float32Array(MAP_CHUNK_FACE_COUNT_Y);
  for (let i = 0; i < MAP_CHUNK_FACE_COUNT_Y; i++) {
    const vy = -(i * MAP_CHUNK_VERTEX_STEP_Y);
    vye[i] = vy;
    vyo[i] = vy - MAP_CHUNK_VERTEX_STEP_Y / 2.0;
  }
  vye[MAP_CHUNK_FACE_COUNT_Y] = -MAP_CHUNK_WIDTH;

  const vertexBuffer = new ArrayBuffer(MAP_CHUNK_VERTEX_COUNT * 16);
  const vertexBufferView = new DataView(vertexBuffer);

  let i = 0;

  for (let x = 0; x < MAP_CHUNK_FACE_COUNT_X + 1; x++) {
    // Evens
    for (let y = 0; y < MAP_CHUNK_FACE_COUNT_Y + 1; y++) {
      vertexBufferView.setFloat32(i * 16 + 0, vxe[x], true);
      vertexBufferView.setFloat32(i * 16 + 4, vye[y], true);

      i++;
    }

    // Odds
    if (x < MAP_CHUNK_FACE_COUNT_X) {
      for (let y = 0; y < MAP_CHUNK_FACE_COUNT_Y; y++) {
        vertexBufferView.setFloat32(i * 16 + 0, vxo[x], true);
        vertexBufferView.setFloat32(i * 16 + 4, vyo[y], true);

        i++;
      }
    }
  }

  return vertexBuffer;
})();

export { DEFAULT_TERRAIN_VERTEX_BUFFER };
