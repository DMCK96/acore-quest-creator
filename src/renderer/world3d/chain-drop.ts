import { placementAt, type PlaceRequest } from './placing';

/**
 * A quest's NPC or object dragged from the chain onto the 3D view: the drag carries the part, and a
 * drop on the ground places a spawn of it there, facing the camera, as a click while placing does.
 */

/** The drag's data type, so the view takes only a quest part and nothing else dropped on it */
export const CHAIN_DRAG_TYPE = 'application/x-awe-quest-part';

export type DraggedPart = { kind: 'creature' | 'gameobject'; entry: number };

export const encodePart = (part: DraggedPart): string => JSON.stringify({ kind: part.kind, entry: part.entry });

/** The part a drag carries; null for anything malformed */
export function decodePart(data: string): DraggedPart | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { kind, entry } = parsed as Record<string, unknown>;
  if (kind !== 'creature' && kind !== 'gameobject') return null;
  if (typeof entry !== 'number' || !Number.isInteger(entry) || entry <= 0) return null;
  return { kind, entry };
}

/** The placement a drop makes; null when the drag is not a part or it landed on the sky */
export function dropToRequest(data: string, ground: { x: number; y: number; z: number } | null, camera: { x: number; y: number }): PlaceRequest | null {
  const part = decodePart(data);
  if (!part || !ground) return null;
  const kind = part.kind === 'gameobject' ? 'object' : 'creature';
  return { target: { kind, entry: part.entry }, at: placementAt(ground, camera, kind) };
}
