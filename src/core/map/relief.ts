import { liquidLevel, terrainHeight, type TerrainFile } from '../game/terrain';
import { GRID_SIZE, pixelInGrid, TILE_PX } from './coords';

/**
 * A grid's terrain as a picture: a height tint lit from the north-west, water in blue, and holes
 * (and grids without terrain) left transparent. Zoomed-out tiles are built by shrinking four tiles
 * into one, so every zoom agrees with the grids underneath.
 */

type Rgb = [number, number, number];

/** Height bands and their colours; heights between two stops blend linearly. */
const TINT: readonly [number, Rgb][] = [
  [-200, [30, 62, 38]],
  [0, [70, 110, 60]],
  [150, [128, 128, 78]],
  [400, [170, 150, 112]],
  [1000, [205, 205, 205]],
];
const WATER: Rgb = [60, 110, 190];
/** Towards the light: from the north-west and above, in (east, south, up). */
const LIGHT = ((): [number, number, number] => {
  const v: [number, number, number] = [-1, -1, 1.4];
  const n = Math.hypot(...v);
  return [v[0] / n, v[1] / n, v[2] / n];
})();
const SHADE_MIN = 0.55;
const SHADE_SPAN = 0.6;

function tint(height: number): Rgb {
  if (height <= TINT[0]![0]) return TINT[0]![1];
  for (let i = 1; i < TINT.length; i++) {
    const [h1, c1] = TINT[i]!;
    const [h0, c0] = TINT[i - 1]!;
    if (height <= h1) {
      const t = (height - h0) / (h1 - h0);
      return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
    }
  }
  return TINT[TINT.length - 1]![1];
}

const clamp = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));

export function emptyPixels(): Uint8Array {
  return new Uint8Array(TILE_PX * TILE_PX * 4);
}

/** One grid's picture, 256 × 256 RGBA; transparent where the grid has no terrain. */
export function reliefPixels(file: TerrainFile | null, gx: number, gy: number): Uint8Array {
  const out = emptyPixels();
  if (!file) return out;
  const size = TILE_PX;
  const heights = new Float64Array(size * size);
  const known = new Uint8Array(size * size);
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const { x, y } = pixelInGrid(gx, gy, col, row, size);
      const h = terrainHeight(file, x, y);
      if (h !== null && Number.isFinite(h)) {
        heights[row * size + col] = h;
        known[row * size + col] = 1;
      }
    }
  }
  const step = GRID_SIZE / size;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const k = row * size + col;
      if (!known[k]) continue;
      const h = heights[k]!;
      const east = col + 1 < size && known[k + 1] ? heights[k + 1]! : h;
      const south = row + 1 < size && known[k + size] ? heights[k + size]! : h;
      const nx = -(east - h) / step;
      const ny = -(south - h) / step;
      const len = Math.hypot(nx, ny, 1);
      const light = (nx * LIGHT[0] + ny * LIGHT[1] + LIGHT[2]) / len;
      const shade = SHADE_MIN + (SHADE_SPAN * (light + 1)) / 2;
      const { x, y } = pixelInGrid(gx, gy, col, row, size);
      const water = liquidLevel(file, x, y);
      const base = water !== null && water > h ? WATER : tint(h);
      const lit = water !== null && water > h ? 0.85 + 0.15 * shade : shade;
      out.set([clamp(base[0] * lit), clamp(base[1] * lit), clamp(base[2] * lit), 255], k * 4);
    }
  }
  return out;
}

/** Four tiles (north-west, north-east, south-west, south-east) shrunk into one; a missing one stays clear. */
export function downsample(children: readonly [Uint8Array | null, Uint8Array | null, Uint8Array | null, Uint8Array | null]): Uint8Array {
  const out = emptyPixels();
  const size = TILE_PX;
  const half = size / 2;
  children.forEach((child, q) => {
    if (!child) return;
    const ox = (q % 2) * half;
    const oy = Math.trunc(q / 2) * half;
    for (let row = 0; row < half; row++) {
      for (let col = 0; col < half; col++) {
        const target = ((oy + row) * size + ox + col) * 4;
        for (let ch = 0; ch < 4; ch++) {
          const at = (r: number, c: number): number => child[(r * size + c) * 4 + ch]!;
          const r2 = row * 2;
          const c2 = col * 2;
          out[target + ch] = Math.round((at(r2, c2) + at(r2, c2 + 1) + at(r2 + 1, c2) + at(r2 + 1, c2 + 1)) / 4);
        }
      }
    }
  });
  return out;
}
