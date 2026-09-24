/**
 * Where things are on a map, in the three systems the map view juggles: the world (yards, X north,
 * Y west, origin in the middle), the server's 64 × 64 grids (the `.map` and `.mmtile` files), and
 * the map's pixels and tiles (north up, 256 px tiles, zoom 0 = the whole map in one tile).
 */

/** `SIZE_OF_GRIDS`: yards per grid side. */
export const GRID_SIZE = 533.3333;
const GRIDS = 64;
const CENTER_GRID = 32;
export const TILE_PX = 256;
/** Zoom 6 is one grid per tile; below 2 a tile would need hundreds of grids. */
export const MIN_ZOOM = 2;
export const MAX_ZOOM = 6;
/** The zoom the painted zone art is drawn at; zoomed-out tiles are shrunk from it. */
export const ART_ZOOM = 5;
/** How far the author may zoom in: past MAX_ZOOM the tiles are enlarged. */
export const MAX_VIEW_ZOOM = 11;

/** Pixels per yard at zoom 0. */
const K = TILE_PX / (GRIDS * GRID_SIZE);
const HALF = CENTER_GRID * GRID_SIZE;

/**
 * Leaflet's `L.Transformation(a, b, c, d)` for `CRS.Simple` with `lat = X` and `lng = Y`:
 * `px = a·Y + b` and `py = c·X + d`, which puts north up and west on the left.
 */
export const LEAFLET_TRANSFORM: [number, number, number, number] = [-K, HALF * K, -K, HALF * K];

export function worldToPixel0(x: number, y: number): { px: number; py: number } {
  return { px: (HALF - y) * K, py: (HALF - x) * K };
}

export function pixel0ToWorld(px: number, py: number): { x: number; y: number } {
  return { x: HALF - py / K, y: HALF - px / K };
}

/** The grid the server loads for a point, as `gridFileName` names it. */
export function gridOf(x: number, y: number): { gx: number; gy: number } {
  const grid = (c: number): number => Math.min(GRIDS - 1, Math.max(0, Math.trunc(CENTER_GRID - c / GRID_SIZE)));
  return { gx: grid(x), gy: grid(y) };
}

/** The grids a tile covers: rows `gx0…` north to south, columns `gy0…` west to east, `span` of each. */
export function tileGrids(zoom: number, tx: number, ty: number): { gx0: number; gy0: number; span: number } {
  const span = 2 ** (MAX_ZOOM - zoom);
  return { gx0: ty * span, gy0: tx * span, span };
}

/** A grid's edges: north and south are X, west and east are Y. */
export function gridBounds(gx: number, gy: number): { north: number; south: number; west: number; east: number } {
  const north = (CENTER_GRID - gx) * GRID_SIZE;
  const west = (CENTER_GRID - gy) * GRID_SIZE;
  return { north, south: north - GRID_SIZE, west, east: west - GRID_SIZE };
}

/** The world point at the centre of pixel (col, row) of a `size`-pixel image of a grid. */
export function pixelInGrid(gx: number, gy: number, col: number, row: number, size: number): { x: number; y: number } {
  const { north, west } = gridBounds(gx, gy);
  return { x: north - ((row + 0.5) * GRID_SIZE) / size, y: west - ((col + 0.5) * GRID_SIZE) / size };
}

/**
 * An area's edge as points: Leaflet sizes a circle from the x axis, which this map mirrors, so a
 * circle would draw at 1 px; a polygon through these points draws at the true radius.
 */
export function circleOutline(x: number, y: number, radius: number, points = 48): { x: number; y: number }[] {
  return Array.from({ length: points }, (_, i) => {
    const angle = (2 * Math.PI * i) / points;
    return { x: x + radius * Math.cos(angle), y: y + radius * Math.sin(angle) };
  });
}
