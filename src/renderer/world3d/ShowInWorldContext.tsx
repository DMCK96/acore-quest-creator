import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/** What to show in the World: where a quest is, or the nearest spawn of one of its NPCs or objects. */
export type ShowTarget = { questId: number } | { questId: number; kind: 'creature' | 'gameobject'; entry: number };

export type ShowInWorld = (target: ShowTarget) => void;

/**
 * What an editor asks the World to do: place spawns of the project's NPC or object, draw (or edit) the
 * patrol of one of its NPC's spawns, show one exact spawn, or show one of the open quest's positions (a
 * marker id, see `questMarkers`) to drag.
 */
export type WorldRequest =
  | { kind: 'creature' | 'object'; entry: number }
  | { kind: 'patrol'; entry: number; guid: number }
  | { kind: 'spawn'; spawn: 'creature' | 'object'; entry: number; guid: number }
  | { kind: 'marker'; id: string };

/** Asks the World; `onEnd` is told once the author is done there (placing stopped, the patrol is done) */
export type PlaceInWorld = (request: WorldRequest, onEnd?: () => void) => void;

const ShowInWorldContext = createContext<ShowInWorld | null>(null);
const PlaceInWorldContext = createContext<PlaceInWorld | null>(null);

/** Gives everything inside the host's way to take the World's camera to a quest or one of its NPCs or objects (by focusing it). */
export function ShowInWorldProvider({ value, children }: { value: ShowInWorld | null; children: ReactNode }): React.JSX.Element {
  return <ShowInWorldContext.Provider value={value}>{children}</ShowInWorldContext.Provider>;
}

/** Gives everything inside the host's way to ask the World to place, draw a patrol or show a spawn. */
export function PlaceInWorldProvider({ value, children }: { value: PlaceInWorld | null; children: ReactNode }): React.JSX.Element {
  return <PlaceInWorldContext.Provider value={value}>{children}</PlaceInWorldContext.Provider>;
}

/** The host's Show in World, or null where there is no World to show (no game client, or outside the app shell). */
export function useShowInWorld(): ShowInWorld | null {
  return useContext(ShowInWorldContext);
}

/** The host's Place in world (and its other requests), or null where there is no World (no game client, or outside the app shell). */
export function usePlaceInWorld(): PlaceInWorld | null {
  return useContext(PlaceInWorldContext);
}

/**
 * For a modal over the World: whether it is stepped aside, and a Place in world that steps it aside while
 * the author works in the World (showing a spawn leaves it be; a quest position is shown to be dragged, so
 * it steps aside) and brings it back once they are done.
 */
export function useAsideForWorld(): [aside: boolean, place: PlaceInWorld | null] {
  const outer = usePlaceInWorld();
  const [aside, setAside] = useState(false);
  const place = useMemo((): PlaceInWorld | null => outer && ((request, onEnd) => {
    if (request.kind === 'spawn') {
      outer(request, onEnd);
      return;
    }
    setAside(true);
    outer(request, () => {
      setAside(false);
      onEnd?.();
    });
  }), [outer]);
  return [aside, place];
}
