import type { SpawnEdit } from '../../edits';

/**
 * The 3D view's undo and redo: each step keeps every whole state a gesture changed, before and after
 * (one spawn's placement, or several spawns and routes moved together), so undoing sends the earlier
 * states again whatever happened in between (a revert from the World changes list).
 */
export interface EditHistory {
  push(before: SpawnEdit[], after: SpawnEdit[]): void;
  /** The states to go back to, or null with nothing to undo */
  undo(): SpawnEdit[] | null;
  /** The states to go forward to again, or null with nothing to redo */
  redo(): SpawnEdit[] | null;
  clear(): void;
  /** Drops what could be redone, keeping what can be undone */
  forgetRedo(): void;
}

export function createHistory(): EditHistory {
  const done: { before: SpawnEdit[]; after: SpawnEdit[] }[] = [];
  const undone: { before: SpawnEdit[]; after: SpawnEdit[] }[] = [];
  return {
    push(before, after) {
      done.push({ before, after });
      undone.length = 0;
    },
    undo() {
      const step = done.pop();
      if (!step) return null;
      undone.push(step);
      return step.before;
    },
    redo() {
      const step = undone.pop();
      if (!step) return null;
      done.push(step);
      return step.after;
    },
    clear() {
      done.length = 0;
      undone.length = 0;
    },
    forgetRedo() {
      undone.length = 0;
    },
  };
}
