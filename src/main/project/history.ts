import { isDeepStrictEqual } from 'node:util';
import type { HistoryList, HistoryPart, NodeMove, StepPlace, StepSummary } from '../../shared/history';

/** How many steps are kept; the oldest go first */
export const HISTORY_LIMIT = 300;
/** Edits to the same fields of a quest this close together are one step, so typing a title is one */
export const TYPING_MERGE_MS = 2000;

export interface HistoryStep {
  id: number;
  /** The window's name for it; null when it is named from its parts */
  label: string | null;
  where: StepPlace | null;
  parts: HistoryPart[];
  /** Made between a begin and an end: never merged into */
  explicit: boolean;
  /** When it last changed, for merging typing */
  at: number;
}

/**
 * The open project's undo history. Pure: it keeps steps and where the project stands among them;
 * the session records into it and puts steps back.
 */
export interface ProjectHistory {
  /** Opens a named step; changes until `end` join it. Nested begins join the outer step */
  begin(label?: string, where?: StepPlace): number;
  end(token: number): void;
  /** Ends every open step, as an undo, redo or jump does first */
  endAll(): void;
  record(part: HistoryPart): void;
  /** The step to put back as it was before; null with nothing to undo */
  undo(): HistoryStep | null;
  /** The step to put back as it was after; null with nothing to redo */
  redo(): HistoryStep | null;
  /** The steps to undo (newest first) or redo (oldest first) to stand just after `stepId`; 0 is before every step */
  jump(stepId: number): { direction: 'undo' | 'redo'; steps: HistoryStep[] };
  /** The step `undo` would give, without moving */
  peekUndo(): HistoryStep | null;
  /** The step `redo` would give, without moving */
  peekRedo(): HistoryStep | null;
  /** The steps `jump` would give, without moving */
  peekJump(stepId: number): { direction: 'undo' | 'redo'; steps: HistoryStep[] };
  list(describe: (step: HistoryStep) => Omit<StepSummary, 'id'>): HistoryList;
  /** The id of the last applied step, 0 before any */
  current(): number;
  markSaved(): void;
  /** Whether the project stands at the saved step */
  atSaved(): boolean;
  clear(): void;
  /** Called after every new step, undo, redo, jump, save and clear. Returns an unsubscribe */
  onChange(listener: () => void): () => void;
}

const partKey = (part: HistoryPart): string => (part.kind === 'quest' ? `quest:${part.questId}` : part.kind);

/** The first before of each quest and the last after, in the order they were first moved */
function mergeMoves(first: { before: NodeMove[]; after: NodeMove[] }, next: { before: NodeMove[]; after: NodeMove[] }): { before: NodeMove[]; after: NodeMove[] } {
  const before = [...first.before];
  for (const m of next.before) if (!before.some((b) => b.questId === m.questId)) before.push(m);
  const after = new Map(first.after.map((m) => [m.questId, m]));
  for (const m of next.after) after.set(m.questId, m);
  return { before, after: before.map((b) => after.get(b.questId) ?? b) };
}

/** A part folded into a step: the same thing changed again keeps its first before and takes the new after */
function mergePart(parts: HistoryPart[], part: HistoryPart): HistoryPart[] {
  const i = parts.findIndex((p) => partKey(p) === partKey(part));
  if (i < 0) return [...parts, part];
  const was = parts[i]!;
  const merged: HistoryPart =
    was.kind === 'positions' && part.kind === 'positions' ? { kind: 'positions', ...mergeMoves(was, part) } : ({ ...part, before: was.before } as HistoryPart);
  return parts.map((p, j) => (j === i ? merged : p));
}

const unchanged = (part: HistoryPart): boolean => isDeepStrictEqual(part.before, part.after);

/** The fields of a quest edit whose values differ, sorted; null for a quest that came or went */
function changedFields(part: HistoryPart): string[] | null {
  if (part.kind !== 'quest' || !part.before || !part.after) return null;
  const a = part.before.aggregate.values;
  const b = part.after.aggregate.values;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => !isDeepStrictEqual(a[k], b[k])).sort();
}

export function createHistory(opts: { now?: () => number; limit?: number } = {}): ProjectHistory {
  const now = opts.now ?? Date.now;
  const limit = opts.limit ?? HISTORY_LIMIT;
  let done: HistoryStep[] = [];
  let undone: HistoryStep[] = [];
  let nextId = 1;
  // The step the project was saved at: 0 is the start, null once it can no longer be reached
  let savedId: number | null = 0;
  let open: HistoryStep | null = null;
  const tokens = new Set<number>();
  let nextToken = 1;
  // Typing merges only into a step made since the last undo, redo or jump
  let mergeable = false;
  const listeners = new Set<() => void>();

  const tell = (): void => {
    for (const l of listeners) l();
  };
  const current = (): number => done.at(-1)?.id ?? 0;
  /** A new step drops what could be redone; a saved step among them can no longer be reached */
  const dropRedo = (): void => {
    if (savedId !== null && undone.some((s) => s.id === savedId)) savedId = null;
    undone = [];
  };
  const prune = (): void => {
    while (done.length > limit) {
      const dropped = done.shift()!;
      // Saved at the start or at the dropped step: neither can be gone back to any more
      if (savedId === 0 || dropped.id === savedId) savedId = null;
    }
  };
  const push = (step: HistoryStep): void => {
    dropRedo();
    done.push(step);
    prune();
  };
  const closeOpen = (): void => {
    const step = open;
    open = null;
    tokens.clear();
    if (!step || step.parts.length === 0 || step.parts.every(unchanged)) return;
    push(step);
    mergeable = false;
    tell();
  };
  /** Whether a part typed now joins the last step rather than making one */
  const mergesInto = (last: HistoryStep | undefined, part: HistoryPart): last is HistoryStep => {
    if (!last || !mergeable || last.explicit || last.id === savedId || last.parts.length !== 1) return false;
    const was = last.parts[0]!;
    if (was.kind !== 'quest' || part.kind !== 'quest' || was.questId !== part.questId) return false;
    if (now() - last.at >= TYPING_MERGE_MS) return false;
    const a = changedFields(was);
    const b = changedFields(part);
    return a !== null && b !== null && isDeepStrictEqual(a, b);
  };

  return {
    begin(label, where) {
      if (!open) open = { id: nextId++, label: label ?? null, where: where ?? null, parts: [], explicit: true, at: now() };
      const token = nextToken++;
      tokens.add(token);
      return token;
    },
    end(token) {
      if (!tokens.delete(token)) return;
      if (tokens.size === 0) closeOpen();
    },
    endAll() {
      if (open) closeOpen();
    },
    record(part) {
      if (open) {
        open.parts = mergePart(open.parts, part);
        open.at = now();
        return;
      }
      const last = done.at(-1);
      if (undone.length === 0 && mergesInto(last, part)) {
        last.parts = mergePart(last.parts, part);
        last.at = now();
        // Typed back to where it began: no step at all
        if (last.parts.every(unchanged)) done.pop();
      } else {
        if (unchanged(part)) return;
        push({ id: nextId++, label: null, where: null, parts: [part], explicit: false, at: now() });
        mergeable = true;
      }
      tell();
    },
    undo() {
      if (open) closeOpen();
      const step = done.pop();
      if (!step) return null;
      undone.push(step);
      mergeable = false;
      tell();
      return step;
    },
    redo() {
      if (open) closeOpen();
      const step = undone.pop();
      if (!step) return null;
      done.push(step);
      mergeable = false;
      tell();
      return step;
    },
    jump(stepId) {
      if (open) closeOpen();
      const steps: HistoryStep[] = [];
      let direction: 'undo' | 'redo' = 'undo';
      if (stepId === 0 || done.some((s) => s.id === stepId)) {
        while (current() !== stepId) {
          const step = done.pop()!;
          undone.push(step);
          steps.push(step);
        }
      } else if (undone.some((s) => s.id === stepId)) {
        direction = 'redo';
        while (current() !== stepId) {
          const step = undone.pop()!;
          done.push(step);
          steps.push(step);
        }
      } else {
        return { direction, steps };
      }
      mergeable = false;
      tell();
      return { direction, steps };
    },
    peekUndo: () => done.at(-1) ?? null,
    peekRedo: () => undone.at(-1) ?? null,
    peekJump(stepId) {
      const at = done.findIndex((s) => s.id === stepId);
      if (stepId === 0 || at >= 0) return { direction: 'undo', steps: done.slice(at + 1).reverse() };
      const ahead = undone.findIndex((s) => s.id === stepId);
      if (ahead >= 0) return { direction: 'redo', steps: undone.slice(ahead).reverse() };
      return { direction: 'undo', steps: [] };
    },
    list(describe) {
      const steps = [...done, ...[...undone].reverse()].map((s) => ({ id: s.id, ...describe(s) }));
      const reachable = savedId === 0 || (savedId !== null && steps.some((s) => s.id === savedId));
      return { steps, current: current(), saved: reachable ? savedId : null };
    },
    current,
    markSaved() {
      savedId = current();
      tell();
    },
    atSaved: () => savedId !== null && savedId === current(),
    clear() {
      open = null;
      tokens.clear();
      done = [];
      undone = [];
      savedId = 0;
      mergeable = false;
      tell();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
