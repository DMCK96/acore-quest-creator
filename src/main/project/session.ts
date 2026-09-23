import { randomUUID } from 'node:crypto';
import type { Viewport } from '../../shared/ipc';
import { InvalidNameError, type ProjectDocument, type ProjectMeta, type ProjectQuest } from './project-file';

/**
 * The open project, held in memory. Nothing here touches a disk: saving is the controller's job,
 * and until then the only other copy is the periodic recovery file.
 *
 * A *change* is anything the user would lose by not saving; it sets `dirty` and bumps `revision`,
 * which is how the recovery timer knows whether there is anything new to write.
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
  rename(name: string): void;
  /** Kept and saved, but panning around is not editing, so it is not a change. */
  setViewport(v: Viewport): void;
  reset(meta: ProjectMeta): void;
  load(doc: ProjectDocument, path: string | null, opts: { dirty: boolean }): void;
  toDocument(): ProjectDocument;
  markSaved(path: string): void;
  /** Called whenever the name, the file path or the dirty flag changes. Returns an unsubscribe. */
  onChange(listener: () => void): () => void;
}

export function createProjectSession(initial: ProjectMeta, newId: () => string = randomUUID): ProjectSession {
  let id = newId();
  let meta: ProjectMeta = structuredClone(initial);
  let quests = new Map<number, ProjectQuest>();
  let filePath: string | null = null;
  let dirty = false;
  let revision = 0;
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const l of listeners) l();
  };
  /** Runs `mutate`, then tells listeners if anything the title shows moved. */
  const watched = (mutate: () => void, always = false): void => {
    const before = [meta.name, filePath, dirty];
    mutate();
    if (always || before[0] !== meta.name || before[1] !== filePath || before[2] !== dirty) notify();
  };
  const change = (): void => {
    dirty = true;
    revision += 1;
  };

  return {
    id: () => id,
    meta: () => structuredClone(meta),
    filePath: () => filePath,
    dirty: () => dirty,
    revision: () => revision,
    quests: {
      get: (questId) => {
        const q = quests.get(questId);
        return q ? structuredClone(q) : undefined;
      },
      list: () => [...quests.values()].sort((a, b) => a.questId - b.questId).map((q) => structuredClone(q)),
      put(q, opts) {
        watched(() => {
          quests.set(q.questId, structuredClone(q));
          if (!opts?.quiet) change();
        });
      },
      remove(questId) {
        if (!quests.has(questId)) return;
        watched(() => {
          quests.delete(questId);
          change();
        });
      },
      setPositions(moves) {
        watched(() => {
          let moved = false;
          for (const m of moves) {
            const q = quests.get(m.questId);
            if (!q || (q.x === m.x && q.y === m.y)) continue;
            q.x = m.x;
            q.y = m.y;
            moved = true;
          }
          if (moved) change();
        });
      },
      markExported(questId, path) {
        const q = quests.get(questId);
        if (!q) return;
        watched(() => {
          q.lastExportPath = path;
          change();
        });
      },
      usedQuestIds: () => [...quests.keys()].sort((a, b) => a - b),
    },
    rename(name) {
      const trimmed = name.trim();
      if (trimmed === '') throw new InvalidNameError('A project needs a name.');
      if (trimmed === meta.name) return;
      watched(() => {
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
        filePath = null;
        dirty = false;
        revision = 0;
      }, true);
    },
    load(doc, path, opts) {
      watched(() => {
        const { quests: docQuests, ...docMeta } = structuredClone(doc);
        id = newId();
        meta = docMeta;
        quests = new Map(docQuests.map((q) => [q.questId, q]));
        filePath = path;
        dirty = opts.dirty;
        revision = opts.dirty ? 1 : 0;
      }, true);
    },
    toDocument: () => ({
      ...structuredClone(meta),
      quests: [...quests.values()].sort((a, b) => a.questId - b.questId).map((q) => structuredClone(q)),
    }),
    markSaved(path) {
      watched(() => {
        filePath = path;
        dirty = false;
      });
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
