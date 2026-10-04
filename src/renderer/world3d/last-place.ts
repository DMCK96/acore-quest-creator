import { WORLD_MAPS, worldMapById } from '@core/map/world-maps';

/** A map and the point the camera looked at there */
export type LastPlace = { map: number; x: number; y: number; z: number };

/** Where the world was left, per viewer: the World workspace opens there next time */
export const LAST_PLACE_KEY = 'acqc.world.lastPlace';

const firstStart = (): LastPlace => ({ map: WORLD_MAPS[0]!.id, ...WORLD_MAPS[0]!.start });

/** The place last written, or the first continent's start when there is none the view can draw */
export function readLastPlace(): LastPlace {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_PLACE_KEY) ?? 'null') as Partial<LastPlace> | null;
    if (!saved || typeof saved !== 'object' || typeof saved.map !== 'number' || !worldMapById(saved.map)) return firstStart();
    const { x, y, z } = saved;
    if (![x, y, z].every((v) => typeof v === 'number' && Number.isFinite(v))) return firstStart();
    return { map: saved.map, x: x!, y: y!, z: z! };
  } catch {
    return firstStart();
  }
}

export function writeLastPlace(place: LastPlace): void {
  try {
    localStorage.setItem(LAST_PLACE_KEY, JSON.stringify({ map: place.map, x: place.x, y: place.y, z: place.z }));
  } catch {
    // Storage unavailable: the world opens at the start next time.
  }
}
