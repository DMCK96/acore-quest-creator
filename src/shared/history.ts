import type { QuestAggregate, Snapshot } from '@core/model/aggregate';
import type { FidelityReport } from '@core/roundtrip/verify';
import type { WorldLayer } from '@core/world/layer';

/**
 * The project's undo history, as the main process keeps it and the window shows it. A step is a
 * label, a place, and the parts of the project it changed, each whole before and after.
 */

/** A quest as the project holds it, less the record of where it was last exported (an undo never changes that) */
export interface QuestEdit {
  questId: number;
  isNew: boolean;
  aggregate: QuestAggregate;
  snapshot: Snapshot | null;
  fidelity: FidelityReport | null;
  x: number;
  y: number;
}

export interface NodeMove {
  questId: number;
  x: number;
  y: number;
}

/** One part of the project a step changed; a quest that is null was not in the project */
export type HistoryPart =
  | { kind: 'quest'; questId: number; before: QuestEdit | null; after: QuestEdit | null }
  | { kind: 'positions'; before: NodeMove[]; after: NodeMove[] }
  | { kind: 'world'; before: WorldLayer; after: WorldLayer }
  | { kind: 'name'; before: string; after: string };

/** Where a step happened, for going to it: a quest (and the module that changed), or a place in the world */
export type StepPlace =
  | { questId: number; module?: string }
  | { map: number; x: number; y: number; z: number; spawn?: { kind: 'creature' | 'gameobject'; guid: number } };

export interface StepSummary {
  id: number;
  label: string;
  kind: 'quest' | 'world' | 'graph' | 'project';
  where: StepPlace | null;
}

/** The steps oldest first, the last one applied (0: none), and the saved one (0: the start; null: no longer in the list) */
export interface HistoryList {
  steps: StepSummary[];
  current: number;
  saved: number | null;
}

/** What an undo, redo or jump did, so the window can show the project as it now is without asking again */
export interface HistoryResult {
  /** The last step applied; null when there was nothing to do */
  step: StepSummary | null;
  direction: 'undo' | 'redo';
  /** Every quest the applied steps touched, as it now is; null when it is no longer in the project */
  quests: { questId: number; aggregate: QuestAggregate | null }[];
  /** The graph's quests moved, or quests came or went */
  positions: boolean;
  /** The world layer as it now is, when it changed */
  world: WorldLayer | null;
  name: boolean;
  /** Parts that could not be applied, with why */
  skipped: string[];
  history: HistoryList;
}
