import type { Placement, WorldLayer, WorldSpawnKind } from '@core/world/layer';

type Point = { x: number; y: number; z: number };

const pointOf = ({ x, y, z }: Placement): Point => ({ x, y, z });
const layerKind = (kind: 'creature' | 'object'): WorldSpawnKind => (kind === 'object' ? 'gameobject' : 'creature');

/**
 * Where a world spawn is stored once the layer `before` became `after` (an undo, a redo, a revert): its place in
 * `after` while that edits or placed it, the database's when `after` let go of an edit `before` had, else null
 * (neither layer moves it, so it is where it was).
 */
export function storedPlaceAfter(before: WorldLayer, after: WorldLayer, kind: 'creature' | 'object', guid: number): Point | null {
  const of = layerKind(kind);
  const edited = (layer: WorldLayer) => layer.spawns.find((s) => s.kind === of && s.guid === guid);
  const now = edited(after);
  if (now) return pointOf(now.current);
  const added = after.added.find((a) => a.kind === of && a.guid === guid);
  if (added) return pointOf(added.placement);
  const dropped = edited(before);
  return dropped ? pointOf(dropped.original) : null;
}
