import { createContext, useContext, type ReactNode } from 'react';

/** What the map is opened to do: place a new NPC or object, or draw a new NPC's patrol. */
export type MapMode =
  | { kind: 'place'; target: { kind: 'npc' | 'object'; entry: number } }
  | { kind: 'patrol'; entry: number; guid: number };

export type MapRequest = { kind: 'focus'; markerId: string | null } | MapMode;

/** Opens the quest map from anywhere inside the quest editor; a marker id (or null) just focuses it. */
type OpenMap = (request: MapRequest | string | null) => void;

const MapOpenerContext = createContext<OpenMap | null>(null);

export function MapOpenerProvider({ open, children }: { open: OpenMap; children: ReactNode }): React.JSX.Element {
  return <MapOpenerContext.Provider value={open}>{children}</MapOpenerContext.Provider>;
}

/** The map opener, or null outside a quest editor (where there is no map to open). */
export function useMapOpener(): OpenMap | null {
  return useContext(MapOpenerContext);
}
