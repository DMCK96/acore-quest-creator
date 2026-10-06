import { useEffect, useRef } from 'react';
import type { FocusPart, FocusSlice } from '../state/app/focus';
import type { ShowTarget } from './ShowInWorldContext';

type Point = { map: number; x: number; y: number; z: number };

export interface FocusFollow {
  /** The focus every view shares; each new `nonce` is followed once */
  focus: FocusSlice['focus'];
  /** When the author last moved the camera, on the clock `focus.at` is read against; asked again once the place is known */
  lastCameraMove(): number;
  /** Whether there is a 3D view to follow in (a game client folder is set) */
  shown: boolean;
  /** Where a quest is, or the nearest spawn of one of its NPCs or objects; null when nothing of it is placed */
  placeOf(target: ShowTarget): Promise<{ spawn: (Point & { guid: number }) | null; name?: string } | { error: string }>;
  /** Takes the camera to a place */
  jump(point: Point): void;
  /** Selects a spawn of the focused part (the host leaves one out of view alone) */
  select(spawn: { kind: 'creature' | 'object'; guid: number }): void;
  /** Says why the camera did not go anywhere */
  note(text: string): void;
  /** The part the view itself just selected and reported as the focus: a focus on it came from there and is not followed */
  selected?(): FocusPart | null;
}

/**
 * The 3D view following the focus: a focused quest takes the camera to where it is, and a focused NPC or
 * object of it to its nearest spawn, which is selected. A camera the author moved after the focus was
 * set stays where it is, though the part is still selected.
 */
export function useFocusFollow(options: FocusFollow): void {
  const latest = useRef(options);
  latest.current = options;
  // The focus last dealt with, by its nonce
  const handled = useRef<number | null>(null);
  const { nonce } = options.focus;
  useEffect(() => {
    const { focus, shown, selected } = latest.current;
    if (!shown || handled.current === focus.nonce) return;
    handled.current = focus.nonce;
    const { questId, part } = focus;
    if (questId === null) return;
    const own = selected?.();
    if (part && own && own.kind === part.kind && own.entry === part.entry) return;
    // The author already went elsewhere: a whole quest has nothing to select, so nothing is looked up
    if (!part && latest.current.lastCameraMove() > focus.at) return;
    void (async () => {
      const place = await latest.current.placeOf(part ? { questId, kind: part.kind, entry: part.entry } : { questId });
      // A newer focus came in meanwhile: it is the one followed
      if (handled.current !== focus.nonce) return;
      const { lastCameraMove, jump, select, note } = latest.current;
      if ('error' in place) return note(place.error);
      if (!place.spawn) {
        note(part && place.name !== undefined ? `${place.name} has no spawn in the world yet.` : 'Nothing of this quest is placed in the world yet.');
        return;
      }
      const { map, x, y, z, guid } = place.spawn;
      if (lastCameraMove() <= focus.at) jump({ map, x, y, z });
      if (part) select({ kind: part.kind === 'gameobject' ? 'object' : 'creature', guid });
    })();
  }, [nonce, options.shown]);
}
