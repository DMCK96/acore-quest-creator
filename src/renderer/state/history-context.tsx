import { createContext, useContext, useMemo } from 'react';
import type { StepPlace } from '@shared/ipc';
import type { WorldLayer } from '@core/world/layer';
import type { AppStore } from './app-store';

/** What views below the app need of the undo history: making one step of several changes, and the world an undo left */
export interface HistorySteps {
  /** Runs `work` as one step of the project's history */
  runStep(work: () => Promise<void>, label?: string, where?: StepPlace): Promise<void>;
  /** Holds undo back while a change is on its way to the project; returns the release */
  hold(): () => void;
  /** The world layer as the last undo or redo left it; its count moves each time */
  worldLayer: { layer: WorldLayer; seq: number } | null;
  /** An AI client is writing to the project: views stay movable but nothing in them can be edited */
  editLocked: boolean;
}

// Outside the app (a view rendered on its own, as in tests) a step is just the work
const standalone: HistorySteps = { runStep: (work) => work(), hold: () => () => {}, worldLayer: null, editLocked: false };
export const HistoryContext = createContext<HistorySteps>(standalone);

export function HistoryProvider({ store, children }: { store: AppStore; children: React.ReactNode }): React.JSX.Element {
  const worldLayer = store((s) => s.worldLayer);
  const editLocked = store((s) => s.aiWriting);
  const value = useMemo<HistorySteps>(
    () => ({ runStep: (work, label, where) => store.getState().historyStep(work, label, where), hold: () => store.getState().holdHistory(), worldLayer, editLocked }),
    [store, worldLayer, editLocked],
  );
  return <HistoryContext.Provider value={value}>{children}</HistoryContext.Provider>;
}

export const useHistorySteps = (): HistorySteps => useContext(HistoryContext);
