import { IDENTITY_FRAME, placementToLocal, type Frame } from '../../core/map/transport-frame';
import type { Placement } from '../../core/world/layer';
import type { SpawnEdit } from './edits';
import type { MenuTarget } from './menu/model';

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

/** The frame an edit of a spawn is stored through: its dock's when it stands at one, else the view's own */
export function frameFor(owner: Frame | null, view: Frame): Frame {
  return owner ?? view;
}

/**
 * Whether a right-click is on a vessel, where walking paths are not edited: the view is a vessel's own, or the
 * spawn hit, or any selected, stands at a docked one. `frameOf` is the scene's answer for a spawn.
 */
export function aboardVessel(
  target: MenuTarget,
  viewIsVessel: boolean,
  frameOf: (kind: 'creature' | 'object', guid: number) => Frame | null,
): boolean {
  if (viewIsVessel) return true;
  const spawns = target.hit?.type === 'spawn' ? [target.hit.spawn, ...target.selection] : target.selection;
  return spawns.some((spawn) => frameOf(spawn.kind, spawn.guid) !== null);
}
