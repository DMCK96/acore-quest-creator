import { worldMapById } from '@core/map/world-maps';
import type { TeleportSpot } from '@core/map/teleports';

/** Well-known places to start from, by their names in the teleport list, in the order offered */
export const QUICK_PICK_NAMES: readonly string[] = [
  'Northshire Valley',
  'Goldshire',
  'Stormwind City',
  'Ironforge',
  'Darnassus',
  'Valley of Trials',
  'Thunder Bluff Lift',
  'Shattrath City Entrance',
];

/** The well-known places the list has on a map the 3D view draws: the first spot of each name */
export function quickPicks(spots: readonly TeleportSpot[]): TeleportSpot[] {
  return QUICK_PICK_NAMES.flatMap((name) => {
    const found = spots.find((s) => s.name === name && worldMapById(s.map) !== null);
    return found ? [found] : [];
  });
}
