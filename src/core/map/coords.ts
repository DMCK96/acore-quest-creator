/**
 * Where things are on a map: the world (yards, X north, Y west, origin in the middle) and the
 * server's 64 × 64 grids (the `.map` and `.mmtile` files).
 */

/** `SIZE_OF_GRIDS`: yards per grid side. */
const GRID_SIZE = 533.3333;
const GRIDS = 64;
const CENTER_GRID = 32;

/** The grid the server loads for a point, as `gridFileName` names it. */
export function gridOf(x: number, y: number): { gx: number; gy: number } {
  const grid = (c: number): number => Math.min(GRIDS - 1, Math.max(0, Math.trunc(CENTER_GRID - c / GRID_SIZE)));
  return { gx: grid(x), gy: grid(y) };
}
