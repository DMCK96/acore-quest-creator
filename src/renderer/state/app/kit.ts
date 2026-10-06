import type { FieldValue } from '@core/registry/types';
import type { Api, NodePosition, ProjectState, Result, Viewport } from '@shared/ipc';

/**
 * What the slices share that is not state: debounce timers, the tokens that drop a slow answer a
 * newer one has overtaken, and what keeps undo waiting for changes on their way. Made once per store.
 */
export interface Kit {
  /** The pause before an edit is sent to the open project */
  saveDelayMs: number;
  saveTimer: ReturnType<typeof setTimeout> | null;
  /** An edit to the project's NPCs waiting to be sent */
  entitiesTimer: ReturnType<typeof setTimeout> | null;
  entitiesPending: boolean;
  entitiesSeq: number;
  /** Guard against an older, slower `search`/`openQuest` response landing after a newer one */
  searchToken: number;
  openToken: number;
  clock: number;
  nodesToken: number;
  /**
   * Each read of the project state is numbered when it is asked for; only the newest is kept, so a
   * read waiting on the graph cannot put back an unsaved marker a later read has cleared
   */
  projectToken: number;
  /** StrictMode runs effects twice in development; launch must still connect only once */
  started: boolean;
  /**
   * The world layers an undo hands the views are counted, never from zero again, so a view that saw
   * one count in an earlier project still sees the next
   */
  layerSeq: number;
  /** Changes on their way to the project, which an undo waits for */
  holds: Set<Promise<void>>;
  /** Steps run one after another, so two that overlap (a paste during a drag) stay two steps */
  stepChain: Promise<void>;
  /** Edits to the open quest made while an undo is on its way: kept on top of what the undo hands back */
  lateEdits: Map<string, FieldValue> | null;
  /**
   * The latest position per quest queued by a drag, and the latest queued viewport, cleared once
   * `flushMoves` has sent them. `lastSavedViewport` is what the API last saw, so an unchanged
   * viewport (a pan back to where it started) does not trigger a redundant save.
   */
  pendingMoves: Map<number, NodePosition>;
  pendingViewport: Viewport | null;
  lastSavedViewport: Viewport;
  /** Reads the project state, numbered so only the newest read is kept */
  readProject(): Promise<{ token: number; result: Result<ProjectState> }>;
  /** Holds undo back until the returned release is called */
  hold(): () => void;
  viewportsEqual(a: Viewport, b: Viewport): boolean;
}

export function createKit(api: Api, opts: { saveDelayMs?: number }): Kit {
  const kit: Kit = {
    saveDelayMs: opts.saveDelayMs ?? 400,
    saveTimer: null,
    entitiesTimer: null,
    entitiesPending: false,
    entitiesSeq: 0,
    searchToken: 0,
    openToken: 0,
    clock: 0,
    nodesToken: 0,
    projectToken: 0,
    started: false,
    layerSeq: 0,
    holds: new Set(),
    stepChain: Promise.resolve(),
    lateEdits: null,
    pendingMoves: new Map(),
    pendingViewport: null,
    lastSavedViewport: { x: 0, y: 0, zoom: 1 },
    async readProject() {
      const token = ++kit.projectToken;
      return { token, result: await api.projectState() };
    },
    hold() {
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      kit.holds.add(held);
      return () => {
        kit.holds.delete(held);
        release();
      };
    },
    viewportsEqual: (a, b) => a.x === b.x && a.y === b.y && a.zoom === b.zoom,
  };
  return kit;
}
