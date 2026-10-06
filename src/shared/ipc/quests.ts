import type { QuestUse } from '@core/entities/links';
import type { UnmodelledColumn } from '@core/import/unmodelled';
import type { UnavailableComponent } from '@core/links/availability';
import type { ComponentId, ComponentInstance } from '@core/links/model';
import type { QuestAggregate } from '@core/model/aggregate';
import type { FieldValue } from '@core/registry/types';
import type { ForeignScene } from '@core/scripts/decompile';
import type { FidelityReport } from '@core/roundtrip/verify';
import type { Issue } from '@core/validate/validate';
import type { Result } from './result';

export interface NodePosition {
  x: number;
  y: number;
}

/** The canvas pan and zoom, saved with the project. */
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface OpenResult {
  questId: number;
  aggregate: QuestAggregate;
  fidelity: FidelityReport;
  unmodelled: UnmodelledColumn[];
  issues: Issue[];
  /** True when the quest was already in the open project, rather than imported by this call. */
  inProject: boolean;
  /** True when the world DB changed under the quest since it was imported. */
  stale: boolean;
  /**
   * The locale codes this quest has translated rows for. Non-empty means an enUS edit leaves those
   * translations stale, which the editor has to say out loud (spec §4.3).
   */
  locales: string[];
  /** Field id -> the translatable English text as imported, so the UI can spot a live edit. */
  importedText: Record<string, FieldValue>;
}

/** A whole quest chain added to the canvas at once. */
export interface ChainResult {
  /** The quest that was picked, opened for editing exactly as `openQuest` would. */
  open: OpenResult;
  /** Every quest of the chain, including ones that were already on the canvas. */
  questIds: number[];
  /** The chain was longer than one add will take, so only part of it was placed. */
  truncated: boolean;
}

/** One quest as the canvas draws it. */
export interface CanvasNode {
  questId: number;
  title: string;
  level: number;
  isNew: boolean;
  exported: boolean;
  /** The stored round-trip report is not ok: exporting this quest would lose data. */
  unsafe: boolean;
  errors: number;
  warnings: number;
  x: number;
  y: number;
  /** The quest-to-quest edges that leave this node, one per target and component. */
  links: NodeLink[];
  /** What offers this quest, as badges in a fixed order so the node never reshuffles them. */
  starts: StartBadge[];
  /** The quest groups this node belongs to. */
  groups: NodeGroup[];
  /** Linked quests that exist in the world but are not drawn, so the user knows the chain goes on. */
  offCanvasLinks: number;
  /** Shares no edge with any other quest on the canvas; also counted in `warnings`. */
  notConnected: boolean;
  /** The project's new NPCs, objects and items the quest uses (the ones it names, and NPCs crediting it) */
  uses: QuestUse;
  /** Everything the quest references, whether or not the project has it */
  refs: QuestUse;
  /** Offered again each day (quest_template.Flags 0x1000) */
  daily?: boolean;
  /** Offered again each week (quest_template.Flags 0x8000) */
  weekly?: boolean;
}

/** How a quest is offered, reduced to the few kinds a canvas node has room to show. */
export type StartBadge = 'npc' | 'object' | 'event' | 'item' | 'script' | 'backend';

/** One edge leaving a node; `owner` is the quest whose rows carry it, which is where it is edited. */
export interface NodeLink {
  to: number;
  component: ComponentId;
  owner: number;
}

export interface NodeGroup {
  group: number;
  kind: 'pickOne' | 'finishAll';
}

/** A component instance with the words the links panel shows for it. */
export interface LinkView extends ComponentInstance {
  label: string;
  summary: string;
}

/** A script row that names a quest but that no component explains. */
export interface UnrecognisedView {
  questId: number;
  key: string;
  summary: string;
}

export interface QuestLinks {
  instances: LinkView[];
  unrecognised: UnrecognisedView[];
  /** Components the connected database cannot support, and why, so their absence is explained. */
  unavailable: UnavailableComponent[];
}

/** What the Scripts module shows beside the quest's own scenes. */
export interface QuestScriptsInfo {
  /** Scripts on the quest's NPCs, objects and areas that the tool did not write. */
  foreign: ForeignScene[];
  /** Scenes the tool wrote before whose stored data can no longer be read; their rows are left alone. */
  unreadable: string[];
  /** Script tables the connected database lacks. */
  missingTables: string[];
}

/** Quests on the canvas: opening, making, laying out, linking, editing and checking them */
export interface QuestsApi {
  openQuest(questId: number, position?: NodePosition): Promise<Result<OpenResult>>;
  newQuest(position?: NodePosition): Promise<Result<OpenResult>>;
  /** Imports the quest and every quest chained to it; `position` is where the picked quest lands. */
  addQuestChain(questId: number, position?: NodePosition): Promise<Result<ChainResult>>;
  listNodes(): Promise<Result<CanvasNode[]>>;
  moveNodes(moves: { questId: number; x: number; y: number }[]): Promise<Result<true>>;
  removeNode(questId: number): Promise<Result<true>>;
  saveViewport(v: Viewport): Promise<Result<true>>;
  /** Every quest link touching these quests, described, with the rows no component explains. */
  questLinks(questIds: number[]): Promise<Result<QuestLinks>>;
  /** Replaces the open project's copy of the quest with the edited aggregate. */
  updateQuest(aggregate: QuestAggregate): Promise<Result<true>>;
  validate(questId: number): Promise<Result<Issue[]>>;
  /** The scripts around the quest that the Scripts module lists read-only. */
  questScripts(questId: number): Promise<Result<QuestScriptsInfo>>;
}
