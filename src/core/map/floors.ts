/**
 * Which height a point on the map gets: one of the navmesh floors there, or the terrain ground when
 * no floor covers it. A marker being dragged stays on the storey it was on; a new one lands lowest.
 */

/** Floors closer than this to the ground are the ground. */
const SAME_FLOOR = 0.5;

export function floorCandidates(result: { floors: number[]; ground: number | null }): number[] {
  const out = [...result.floors];
  const ground = result.ground;
  if (ground !== null && !out.some((z) => Math.abs(z - ground) <= SAME_FLOOR)) out.push(ground);
  return out.sort((a, b) => a - b);
}

/** The candidate nearest `previousZ` (the lower on a tie), the lowest without one, null without candidates. */
export function chooseZ(candidates: readonly number[], previousZ: number | null): number | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => a - b);
  if (previousZ === null) return sorted[0]!;
  let best = sorted[0]!;
  for (const z of sorted) if (Math.abs(z - previousZ) < Math.abs(best - previousZ)) best = z;
  return best;
}

/** Where a new marker lands: on the ground (or the floor that is the ground) when there is ground, else the lowest floor. */
export function addZ(result: { floors: number[]; ground: number | null }): number | null {
  const ground = result.ground;
  if (ground !== null) return result.floors.find((z) => Math.abs(z - ground) <= SAME_FLOOR) ?? ground;
  return chooseZ(result.floors, null);
}
