import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/** What to show in the World: where a quest is, or the nearest spawn of one of its NPCs or objects. */
export type ShowTarget = { questId: number } | { questId: number; kind: 'creature' | 'gameobject'; entry: number };

export type ShowInWorld = (target: ShowTarget) => void;

/**
 * What an editor asks the World to do: place spawns of the project's NPC or object, draw (or edit) the
 * patrol of one of its NPC's spawns, show one exact spawn, show one of the open quest's positions (a
 * marker id, see `questMarkers`) to drag, or show a quest or one of its NPCs or objects (Show in World
 * and Go to from inside an editor, which the focus does).
 */
export type WorldRequest =
  | { kind: 'creature' | 'object'; entry: number }
  | { kind: 'patrol'; entry: number; guid: number }
  | { kind: 'spawn'; spawn: 'creature' | 'object'; entry: number; guid: number }
  | { kind: 'marker'; id: string }
  | { kind: 'show'; target: ShowTarget };

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
 * For a modal over the World: whether it is stepped aside, and a Place in world and a Show in World that
 * step it aside while the author works or looks in the World (the modal would hide what the camera went
 * to) and bring it back once they are done there.
 */
export function useAsideForWorld(): [aside: boolean, place: PlaceInWorld | null, show: ShowInWorld | null] {
  const outer = usePlaceInWorld();
  const [aside, setAside] = useState(false);
  return useMemo(() => {
    if (!outer) return [aside, null, null];
    const place: PlaceInWorld = (request, onEnd) => {
      setAside(true);
      outer(request, () => {
        setAside(false);
        onEnd?.();
      });
    };
    return [aside, place, (target) => place({ kind: 'show', target })];
  }, [outer, aside]);
}
