import { createContext, useContext, type ReactNode } from 'react';

/** What to show in the World: where a quest is, or the nearest spawn of one of its NPCs or objects. */
export type ShowTarget = { questId: number } | { questId: number; kind: 'creature' | 'gameobject'; entry: number };

export type ShowInWorld = (target: ShowTarget) => void;

const ShowInWorldContext = createContext<ShowInWorld | null>(null);

/** Gives everything inside the host's way to take the World's camera to a quest or one of its NPCs or objects (by focusing it). */
export function ShowInWorldProvider({ value, children }: { value: ShowInWorld | null; children: ReactNode }): React.JSX.Element {
  return <ShowInWorldContext.Provider value={value}>{children}</ShowInWorldContext.Provider>;
}

/** The host's Show in World, or null where there is no World to show (no game client, or outside the app shell). */
export function useShowInWorld(): ShowInWorld | null {
  return useContext(ShowInWorldContext);
}
