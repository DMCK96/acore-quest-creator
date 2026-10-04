import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Viewport } from '../../shared/ipc';
import { EMPTY_WORLD, type WorldLayer } from '../../core/world/layer';
import { InvalidNameError, type ProjectDocument, type ProjectMeta, type ProjectQuest } from './project-file';
import { createHistory, type HistoryStep, type ProjectHistory } from './history';
import type { NodeMove, QuestEdit } from '../../shared/history';

/**
 * The open project, held in memory. Nothing here touches a disk: saving is the controller's job,
 * and until then the only other copy is the periodic recovery file.
 *
 * A *change* is anything the user would lose by not saving; it bumps `revision`, which is how the
 * recovery timer knows whether there is anything new to write. Every change the user made is also a
 * step of the history, so it can be undone; the project is unsaved while it stands away from the
 * step it was saved at, or after a change that is not undone (a quest marked exported).
 */
export interface ProjectSession {
  /** Names this session's recovery file; new on every `reset` and `load`. */
  id(): string;
  meta(): ProjectMeta;
  /** `null` while the project has never been saved. */
  filePath(): string | null;
  dirty(): boolean;
  revision(): number;
  quests: {
    get(questId: number): ProjectQuest | undefined;
    /** Ordered by quest id. */
    list(): ProjectQuest[];
    /** `quiet` stores without calling it an edit, e.g. a recomputed fidelity report. */
    put(q: ProjectQuest, opts?: { quiet?: boolean }): void;
    remove(questId: number): void;
    setPositions(moves: readonly { questId: number; x: number; y: number }[]): void;
    markExported(questId: number, path: string): void;
    usedQuestIds(): number[];
  };
  /** Edits to spawns and routes outside any quest; a put is a change. */
  world: {
    get(): WorldLayer;
    put(layer: WorldLayer): void;
  };
  rename(name: string): void;
  /** The undo history of this project; cleared by `reset` and `load` */
  history: ProjectHistory;
  /**
   * Puts a step's parts back as they were before it ('undo') or after it ('redo'), as one change and
   * without recording it; the parts at the indexes in `skip` are left alone
   */
  applyStep(step: HistoryStep, direction: 'undo' | 'redo', skip?: ReadonlySet<number>): void;
  /** Kept and saved, but panning around is not editing, so it is not a change. */
  setViewport(v: Viewport): void;
  reset(meta: ProjectMeta): void;
  load(doc: ProjectDocument, path: string | null, opts: { dirty: boolean }): void;
  toDocument(): ProjectDocument;
  markSaved(path: string): void;
  /** Called whenever the name, the file path or the dirty flag changes. Returns an unsubscribe. */
  onChange(listener: () => void): () => void;
}

/** A quest as the history keeps it: everything but where it was last exported */
const editOf = (q: ProjectQuest): QuestEdit => {
  const { lastExportPath: _exported, ...edit } = structuredClone(q);
  return edit;
};

export function createProjectSession(initial: ProjectMeta, newId: () => string = randomUUID, opts: { now?: () => number } = {}): ProjectSession {
  let id = newId();
  let meta: ProjectMeta = structuredClone(initial);
  let quests = new Map<number, ProjectQuest>();
  let world: WorldLayer = structuredClone(EMPTY_WORLD);
  let filePath: string | null = null;
  // A change that is not a step of the history (marking a quest exported) still needs saving
  let extraDirty = false;
  let revision = 0;
  const history = createHistory({ now: opts.now });
  const dirty = (): boolean => extraDirty || !history.atSaved();
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const l of listeners) l();
  };
  /** Runs `mutate`, then tells listeners if anything the title shows moved. */
  const watched = (mutate: () => void, always = false): void => {
    const before = [meta.name, filePath, dirty()];
    mutate();
    if (always || before[0] !== meta.name || before[1] !== filePath || before[2] !== dirty()) notify();
  };
  const change = (): void => {
    revision += 1;
  };

  return {
    id: () => id,
    meta: () => structuredClone(meta),
    filePath: () => filePath,
    dirty,
    revision: () => revision,
    quests: {
      get: (questId) => {
        const q = quests.get(questId);
        return q ? structuredClone(q) : undefined;
      },
      list: () => [...quests.values()].sort((a, b) => a.questId - b.questId).map((q) => structuredClone(q)),
      put(q, putOpts) {
        const was = quests.get(q.questId);
        if (putOpts?.quiet) {
          quests.set(q.questId, structuredClone(q));
          return;
        }
        // The same quest put back is not a change, so it is no step either
        if (was && isDeepStrictEqual(was, q)) return;
        watched(() => {
          quests.set(q.questId, structuredClone(q));
          history.record({ kind: 'quest', questId: q.questId, before: was ? editOf(was) : null, after: editOf(q) });
          change();
        });
      },
      remove(questId) {
        const was = quests.get(questId);
        if (!was) return;
        watched(() => {
          quests.delete(questId);
          history.record({ kind: 'quest', questId, before: editOf(was), after: null });
          change();
        });
      },
      setPositions(moves) {
        watched(() => {
          const before: NodeMove[] = [];
          const after: NodeMove[] = [];
          for (const m of moves) {
            const q = quests.get(m.questId);
            if (!q || (q.x === m.x && q.y === m.y)) continue;
            before.push({ questId: q.questId, x: q.x, y: q.y });
            after.push({ questId: q.questId, x: m.x, y: m.y });
            q.x = m.x;
            q.y = m.y;
          }
          if (after.length === 0) return;
          history.record({ kind: 'positions', before, after });
          change();
        });
      },
      markExported(questId, path) {
        const q = quests.get(questId);
        if (!q) return;
        // A file was written: the project records where, but there is nothing to undo
        watched(() => {
          q.lastExportPath = path;
          extraDirty = true;
          change();
        });
      },
      usedQuestIds: () => [...quests.keys()].sort((a, b) => a - b),
    },
    world: {
      get: () => structuredClone(world),
      put(layer) {
        if (isDeepStrictEqual(world, layer)) return;
        watched(() => {
          const was = world;
          world = structuredClone(layer);
          history.record({ kind: 'world', before: was, after: structuredClone(layer) });
          change();
        });
      },
    },
    rename(name) {
      const trimmed = name.trim();
      if (trimmed === '') throw new InvalidNameError('A project needs a name.');
      if (trimmed === meta.name) return;
      watched(() => {
        history.record({ kind: 'name', before: meta.name, after: trimmed });
        meta = { ...meta, name: trimmed };
        change();
      });
    },
    setViewport(v) {
      meta = { ...meta, viewport: { ...v } };
    },
    reset(next) {
      watched(() => {
        id = newId();
        meta = structuredClone(next);
        quests = new Map();
        world = structuredClone(EMPTY_WORLD);
        filePath = null;
        extraDirty = false;
        history.clear();
        revision = 0;
      }, true);
    },
    load(doc, path, loadOpts) {
      watched(() => {
        const { quests: docQuests, world: docWorld, ...docMeta } = structuredClone(doc);
        id = newId();
        meta = docMeta;
        world = docWorld ?? structuredClone(EMPTY_WORLD);
        quests = new Map(docQuests.map((q) => [q.questId, q]));
        filePath = path;
        history.clear();
        extraDirty = loadOpts.dirty;
        revision = loadOpts.dirty ? 1 : 0;
      }, true);
    },
    toDocument: () => ({
      ...structuredClone(meta),
      quests: [...quests.values()].sort((a, b) => a.questId - b.questId).map((q) => structuredClone(q)),
      world: structuredClone(world),
    }),
    markSaved(path) {
      watched(() => {
        filePath = path;
        extraDirty = false;
        history.markSaved();
      });
    },
    history,
    applyStep(step, direction, skip) {
      watched(() => {
        step.parts.forEach((part, i) => {
          if (skip?.has(i)) return;
          const undoing = direction === 'undo';
          if (part.kind === 'quest') {
            const edit = undoing ? part.before : part.after;
            if (!edit) quests.delete(part.questId);
            else quests.set(part.questId, { ...structuredClone(edit), lastExportPath: quests.get(part.questId)?.lastExportPath ?? null });
          } else if (part.kind === 'positions') {
            for (const m of undoing ? part.before : part.after) {
              const q = quests.get(m.questId);
              if (q) {
                q.x = m.x;
                q.y = m.y;
              }
            }
          } else if (part.kind === 'world') {
            world = structuredClone(undoing ? part.before : part.after);
          } else {
            meta = { ...meta, name: undoing ? part.before : part.after };
          }
        });
        change();
      }, true);
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
