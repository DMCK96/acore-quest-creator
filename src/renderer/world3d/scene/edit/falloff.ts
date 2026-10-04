/**
 * Falloff, as Blender's proportional editing has it: when route points are moved, the other points
 * of their routes nearby follow by a share of the move, 1 at a moved point falling smoothly to 0 at
 * the radius. Distance is across the ground, to the nearest moved point.
 */

/** Yards: where the radius starts, and how small and large it may go */
export const FALLOFF_DEFAULT = 10;
export const FALLOFF_MIN = 1;
export const FALLOFF_MAX = 200;
/** One step of the radius (a key, a wheel notch) grows or shrinks it by this share */
const STEP = 0.1;

export type Falloff = { on: boolean; radius: number };

/** The share of a move a point this far from the nearest moved point gets */
export function falloffWeight(distance: number, radius: number): number {
  if (distance >= radius) return 0;
  const t = Math.max(0, distance / radius);
  return 1 - t * t * (3 - 2 * t);
}

/** Each other point's share of the move, by its key; points out of reach are left out */
export function falloffWeights(selected: { x: number; y: number }[], others: { key: string; x: number; y: number }[], radius: number): Map<string, number> {
  const weights = new Map<string, number>();
  for (const other of others) {
    const nearest = Math.min(...selected.map((s) => Math.hypot(other.x - s.x, other.y - s.y)));
    const weight = falloffWeight(nearest, radius);
    if (weight > 0) weights.set(other.key, weight);
  }
  return weights;
}

/** The radius one step larger (1) or smaller (-1), kept within its bounds */
export function stepRadius(radius: number, direction: 1 | -1): number {
  return Math.min(FALLOFF_MAX, Math.max(FALLOFF_MIN, radius * (1 + direction * STEP)));
}
