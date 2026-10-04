import { createContext, useContext, type ReactNode } from 'react';
import type { CustomItem, CustomNpc, CustomObject } from '@core/entities/model';

/**
 * Opening the one NPC, object or item editor from anywhere inside the quest editor or the World. A new one
 * is created in the project there and then (never a draft), made for `madeFor` (by default the open quest), `onCreated` hears its entry at once, and the editor
 * opens on it. The promise gives an error message when nothing could be opened.
 */
export type EditorRequest =
  | { kind: 'npc' | 'object' | 'item'; entry: number }
  | { kind: 'newNpc'; preset?: Partial<CustomNpc>; madeFor?: number | null; onCreated?(entry: number): void }
  | { kind: 'newObject'; preset?: Partial<CustomObject>; madeFor?: number | null; onCreated?(entry: number): void }
  | { kind: 'newItem'; preset?: Partial<CustomItem>; madeFor?: number | null; onCreated?(entry: number): void };

export type OpenEditor = (request: EditorRequest) => Promise<string | null>;

const EntityEditorContext = createContext<OpenEditor | null>(null);

export function EntityEditorProvider({ open, children }: { open: OpenEditor; children: ReactNode }): React.JSX.Element {
  return <EntityEditorContext.Provider value={open}>{children}</EntityEditorContext.Provider>;
}

/** The editor opener, or null outside a quest editor. */
export function useEntityEditor(): OpenEditor | null {
  return useContext(EntityEditorContext);
}
