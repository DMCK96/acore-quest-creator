import { IDENTITY_FRAME, placementToLocal, type Frame } from '../../core/map/transport-frame';
import type { Placement } from '../../core/world/layer';
import type { SpawnEdit } from './edits';

const isIdentity = (f: Frame): boolean =>
  f.x === IDENTITY_FRAME.x && f.y === IDENTITY_FRAME.y && f.z === IDENTITY_FRAME.z && f.heading === IDENTITY_FRAME.heading;

/** A place in the scene's world coordinates as a row stores it for a spawn living in `frame`; the identity frame changes nothing */
export function localisePlacement(at: Placement, frame: Frame): Placement {
  return isIdentity(frame) ? at : placementToLocal(frame, at);
}

/**
 * An edit made in the scene's world coordinates, as it should reach the database or layer for a spawn
 * living in `frame` (a vessel's pose). Positions become vessel-local; a route edit is dropped (`null`)
 * because walking paths on a vessel are not edited yet. The identity frame changes nothing.
 */
export function localiseEdit(edit: SpawnEdit, frame: Frame): SpawnEdit | null {
  if (isIdentity(frame)) return edit;
  switch (edit.kind) {
    case 'place':
      return { ...edit, to: localisePlacement(edit.to, frame) };
    case 'presence':
      return { ...edit, at: localisePlacement(edit.at, frame) };
    case 'route':
      return null;
    default:
      return edit;
  }
}
