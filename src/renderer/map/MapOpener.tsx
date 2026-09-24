import { createContext, useContext, type ReactNode } from 'react';

/** Opens the quest map on one marker (or on the quest), from anywhere inside the quest editor. */
type OpenMap = (markerId: string | null) => void;

const MapOpenerContext = createContext<OpenMap | null>(null);

export function MapOpenerProvider({ open, children }: { open: OpenMap; children: ReactNode }): React.JSX.Element {
  return <MapOpenerContext.Provider value={open}>{children}</MapOpenerContext.Provider>;
}

/** The map opener, or null outside a quest editor (where there is no map to open). */
export function useMapOpener(): OpenMap | null {
  return useContext(MapOpenerContext);
}
