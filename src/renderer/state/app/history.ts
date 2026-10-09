import type { HistoryList, HistoryResult, Result, StepPlace } from '@shared/ipc';
import type { FieldValue } from '@core/registry/types';
import type { SliceArgs } from './types';

/** The project history: undo, redo, jumping, and grouping changes into one step */
export interface HistorySlice {
  /** The project's undo history, as the main process last told it */
  history: HistoryList;
  /** What the last undo or redo did, for the note; null once dismissed */
  historyNote: { text: string; where: StepPlace | null; skipped: string[] } | null;
  /** An AI client's write is on its way: the quest editor is greyed out and takes no input until it is over */
  aiWriting: boolean;
  /** Sends what is pending, then puts the last change anywhere in the project back */
  undo(): Promise<void>;
  redo(): Promise<void>;
  /** Undoes or redoes to stand just after a step of the history (0: before every step) */
  jumpTo(stepId: number): Promise<void>;
  /** Runs `work` as one step of the history: everything it changes, and the quest edit it leaves pending, is undone together */
  historyStep(work: () => Promise<void>, label?: string, where?: StepPlace): Promise<void>;
  /**
   * Holds undo back while a change is on its way to the project (a 3D gesture waiting for the floor):
   * an undo waits for it, so it takes that change back and not the one before. Returns the release
   */
  holdHistory(): () => void;
  setHistory(list: HistoryList): void;
  dismissHistoryNote(): void;
  /**
   * Shows a change the main process made on its own (an AI client, through MCP). Main already asked this
   * window for its pending edits, so nothing is sent first; an edit typed while this runs stays on top.
   * An edit typed after that flush is held back by `holdEdits` and put on top of the change here.
   */
  applyExternalChange(change: HistoryResult): Promise<void>;
  /**
   * An AI client's write begins (`true`) or is over (`false`). While it runs, quest edits typed here are
   * kept back and shown on top of the change when it arrives, so nothing older is sent over the write.
   */
  holdEdits(held: boolean): void;
}

/** Reads the project history into the store */
export async function loadHistory({ api, set }: Pick<SliceArgs, 'api' | 'set'>): Promise<void> {
  const list = await api.historyList();
  if (list.ok) set({ history: list.value });
}

/** How long the window holds its quest edits back for one AI write: the write's own limit and a margin */
const HOLD_LIMIT_MS = 130_000;

/** How many times an undo sends what is pending before it gives up on an author still typing */
const MAX_FLUSH_ROUNDS = 5;

export function createHistorySlice({ api, kit, set, get }: SliceArgs): HistorySlice {
  /** The edits typed since the hold began, which the change puts back on top of itself */
  let holdMap: Map<string, FieldValue> | null = null;
  /**
   * An undo, redo or jump. What is pending goes first, so the undo takes back the newest change and
   * not the one before it; an edit typed while that was on its way is sent too. If it could not be
   * saved, nothing is undone, and the error says why.
   */
  async function travel(call: () => Promise<Result<HistoryResult>>): Promise<void> {
    while (kit.holds.size > 0) await Promise.all([...kit.holds]);
    for (let round = 0; round < MAX_FLUSH_ROUNDS; round++) {
      await get().flushAll();
      if (!get().dirty || get().error !== null) break;
    }
    if (get().dirty) {
      if (get().error === null) set({ error: 'Nothing was undone or redone: an edit is still being sent. Try again.' });
      return;
    }
    kit.lateEdits = new Map();
    try {
      const result = await call();
      if (!result.ok) {
        set({ error: result.error.message });
        return;
      }
      await applyHistory(result.value);
    } finally {
      // An undo that did not touch the open quest leaves its late edits where they are, already sent
      kit.lateEdits = null;
    }
  }

  /** Shows the project as the undo left it: the open quest, the graph, the world layer, the name */
  async function applyHistory(result: HistoryResult, note?: string): Promise<void> {
    const state = get();
    set({ history: result.history });
    const open = state.open;
    const mine = open ? result.quests.find((q) => q.questId === open.questId) : undefined;
    if (open && mine) {
      if (mine.aggregate === null) {
        set({ screen: 'pick', open: null, dirty: false, links: null, openPanel: null });
        get().setFocus(null);
      } else {
        const late = kit.lateEdits;
        kit.lateEdits = null;
        set({ open: { ...open, aggregate: mine.aggregate }, dirty: false, exportResult: null });
        // An edit made while the undo was on its way goes on top, and is sent as a change of its own
        if (late) for (const [fieldId, value] of late) get().setValue(fieldId, value);
        // The Changes panel compares the quest as it was; it is read again for the quest as it now is
        if (get().preview !== null) await get().loadPreview();
        const issues = await api.validate(open.questId);
        if (issues.ok) set({ issues: issues.value });
        await get().loadLinks();
      }
    }
    if (result.world) {
      const world = result.world;
      set({ worldLayer: { layer: world, seq: ++kit.layerSeq }, layer: world });
    }
    if (result.entities) set({ entities: result.entities, entitiesSeq: ++kit.entitiesSeq });
    if (result.step) {
      // A quest the undo took out of the project cannot be shown: opening it would put it back
      const where = result.step.where;
      const gone = where && 'questId' in where && result.quests.some((q) => q.questId === where.questId && q.aggregate === null);
      set({
        historyNote: { text: note ?? `${result.direction === 'undo' ? 'Undid' : 'Redid'}: ${result.step.label}`, where: gone ? null : where, skipped: result.skipped },
      });
    }
    if (result.positions || result.quests.length > 0) await get().loadNodes();
    else {
      // A rotation's tags follow the world layer the undo left
      if (result.world) await get().loadQuestPools();
      await get().loadProjectState();
    }
  }

  return {
    history: { steps: [], current: 0, saved: 0 },
    historyNote: null,
    aiWriting: false,
    async applyExternalChange(change) {
      // Edits typed since the hold began are already collected; otherwise only those typed while this runs are
      kit.lateEdits ??= new Map();
      try {
        await applyHistory(change, change.step?.label);
      } finally {
        kit.lateEdits = null;
      }
    },
    holdEdits(held) {
      if (kit.holdTimer) clearTimeout(kit.holdTimer);
      kit.holdTimer = null;
      set({ aiWriting: held });
      if (held) {
        kit.held = true;
        holdMap = new Map();
        kit.lateEdits = holdMap;
        // A write is given up on after two minutes; let go a little after, should the end never arrive
        kit.holdTimer = setTimeout(() => get().holdEdits(false), HOLD_LIMIT_MS);
        return;
      }
      kit.held = false;
      // No change arrived (the tool failed or changed nothing here): what was typed meanwhile is still pending
      if (kit.lateEdits === holdMap) kit.lateEdits = null;
      holdMap = null;
      if (get().dirty) void get().flushSave();
    },
    undo: () => travel(() => api.historyUndo()),
    redo: () => travel(() => api.historyRedo()),
    jumpTo: (stepId) => travel(() => api.historyJump(stepId)),
    async historyStep(work, label, where) {
      const release = kit.hold();
      const step = async (): Promise<void> => {
        // A quest edit typed before the step began is a step of its own
        await get().flushSave();
        await get().flushEntities();
        const begun = await api.historyBegin(label, where);
        if (!begun.ok) {
          await work();
          return;
        }
        try {
          await work();
          // A quest edit the work made is still on the debounce: it belongs to this step
          await get().flushSave();
          await get().flushEntities();
        } finally {
          await api.historyEnd(begun.value);
        }
      };
      const mine = kit.stepChain.then(step, step);
      kit.stepChain = mine.catch(() => undefined);
      try {
        await mine;
      } finally {
        release();
      }
    },
    holdHistory: () => kit.hold(),
    setHistory(list) {
      set({ history: list });
      // A step closed after its changes (a gesture's end) can be what leaves the project unsaved
      void get().loadProjectState();
    },
    dismissHistoryNote() {
      set({ historyNote: null });
    },
  };
}
