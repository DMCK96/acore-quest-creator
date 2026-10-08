import { WORLD_MAPS, worldMapById } from '@core/map/world-maps';
import type { TransportView } from '@core/map/transport-view';

/** A map and the point the camera looked at there; on a transport, also its route and stop */
export type LastPlace = { map: number; x: number; y: number; z: number; transport?: TransportView };

/** Where the world was left, per viewer: the World workspace opens there next time */
export const LAST_PLACE_KEY = 'acqc.world.lastPlace';

const firstStart = (): LastPlace => ({ map: WORLD_MAPS[0]!.id, ...WORLD_MAPS[0]!.start });

const isView = (v: unknown): v is TransportView =>
  typeof v === 'object' && v !== null && Number.isInteger((v as TransportView).template) && Number.isInteger((v as TransportView).node);

/**
 * The place last written, whether or not its map is known yet (a dungeon's or a transport's is only known once the
 * client's maps are read), or null when none was written or it cannot be read
 */
export function readSavedPlace(): LastPlace | null {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_PLACE_KEY) ?? 'null') as Partial<LastPlace> | null;
    if (!saved || typeof saved !== 'object' || typeof saved.map !== 'number') return null;
    const { x, y, z } = saved;
    if (![x, y, z].every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
    const transport = isView(saved.transport) ? { template: saved.transport.template, node: saved.transport.node } : undefined;
    return { map: saved.map, x: x!, y: y!, z: z!, ...(transport && { transport }) };
  } catch {
    return null;
  }
}

/** The place last written, or the first continent's start when there is none the view can draw */
export function readLastPlace(): LastPlace {
  const saved = readSavedPlace();
  return saved && worldMapById(saved.map) ? saved : firstStart();
}

export function writeLastPlace(place: LastPlace): void {
  try {
    const { map, x, y, z, transport } = place;
    localStorage.setItem(LAST_PLACE_KEY, JSON.stringify({ map, x, y, z, ...(transport && { transport: { template: transport.template, node: transport.node } }) }));
  } catch {
    // Storage unavailable: the world opens at the start next time.
  }
}
