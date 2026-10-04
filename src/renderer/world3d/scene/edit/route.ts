import type { EditPoint } from '../../edits';

/**
 * The rules of editing a route in the 3D view, apart from drawing it: where a Shift-click puts a
 * new point, and whether a point may go. A route is a loop, so the last point leads back to the first.
 */

/** A route needs two points to be one */
export const MIN_ROUTE_POINTS = 2;

/** A click this close (in yards, across the ground) to a leg puts the new point on that leg */
const ON_LEG = 2;

/** How far a point is from the segment a–b, across the ground */
function legDistance(at: { x: number; y: number }, a: EditPoint, b: EditPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((at.x - a.x) * dx + (at.y - a.y) * dy) / length));
  return Math.hypot(at.x - (a.x + t * dx), at.y - (a.y + t * dy));
}

/**
 * Where a new point on a leg goes: between the ends of the nearest leg the click is within 2 yards of
 * (the leg back to the first point puts it at the end), or null when it is near none
 */
export function legIndex(points: readonly EditPoint[], at: { x: number; y: number }): number | null {
  let index: number | null = null;
  let nearest = ON_LEG;
  for (let i = 0; i < points.length; i++) {
    const distance = legDistance(at, points[i]!, points[(i + 1) % points.length]!);
    if (distance < nearest || (index === null && distance === nearest)) {
      index = i + 1;
      nearest = distance;
    }
  }
  return index;
}

/** Where a new point goes: on the nearest leg the click is close to, else after the selected point, else at the end */
export function insertionIndex(points: readonly EditPoint[], at: { x: number; y: number }, selected: number | null): number {
  return legIndex(points, at) ?? (selected !== null ? selected + 1 : points.length);
}

/** The route without one point, or null when that would leave it too short to walk */
export function withoutPoint(points: readonly EditPoint[], index: number): EditPoint[] | null {
  if (points.length <= MIN_ROUTE_POINTS) return null;
  return points.filter((_, i) => i !== index);
}
