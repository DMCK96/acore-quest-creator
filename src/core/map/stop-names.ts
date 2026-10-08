import type { TeleportSpot } from './teleports';

/** Farther than this from every known place, a stop is named by its continent alone */
const NEAR = 500;

/** A teleport table name without its taxi-master tag and path: `[EK]Wetlands/Menethil Harbor` is `Menethil Harbor` */
const cleanName = (name: string): string => name.replace(/^\[\w+\]/, '').split('/').pop()!.trim();

/** A table zone, or null for the entries that hold a taxi master's kind ("3 Wind Rider Master") or a battleground's group */
const cleanZone = (zone: string): string | null => (/^\d|\//.test(zone) ? null : zone);

/**
 * What to call a place on a map: the nearest named spot of the teleport table on that map, with its zone, or
 * the continent's name when none is near. Ships and zeppelins that never leave a continent are told apart by this.
 */
export function placeName(at: { map: number; x: number; y: number }, spots: readonly TeleportSpot[], continent: string): string {
  let best: TeleportSpot | null = null;
  let bestDistance = NEAR;
  for (const spot of spots) {
    if (spot.map !== at.map) continue;
    const distance = Math.hypot(spot.x - at.x, spot.y - at.y);
    if (distance < bestDistance) {
      best = spot;
      bestDistance = distance;
    }
  }
  if (!best) return continent;
  const name = cleanName(best.name);
  const zone = cleanZone(best.zone);
  return zone && zone !== name ? `${name}, ${zone}` : `${name} (${continent})`;
}
