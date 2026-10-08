import type { HistoryResult } from '../../shared/history';
import type { Result } from '../../shared/ipc';
import { resultOfSteps } from '../api/step-result';
import { describeStep } from '../project/step-labels';
import type { McpContext, ToolDef } from './tool';

const DEFAULT_FLUSH_TIMEOUT_MS = 5000;

const crashed = (error: unknown): Result<never> => ({
  ok: false,
  error: { code: 'UNKNOWN', message: error instanceof Error ? error.message : String(error) },
});

/** Waits for the window to hand over its pending edits, but never longer than `timeoutMs`. */
async function flushed(ctx: McpContext): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ctx.flushTimeoutMs ?? DEFAULT_FLUSH_TIMEOUT_MS);
  });
  try {
    await Promise.race([ctx.flush().catch(() => undefined), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs tools so that what Claude changes stays one undoable step the window hears about.
 *
 * Read tools run as they are. Write tools run one at a time: the window is asked to hand over its
 * pending edits, the tool's changes become one history step with the tool's label, and the window
 * is told what changed. The queue belongs to the guard, so every server has its own.
 */
export type WriteGuard = (ctx: McpContext, tool: ToolDef, args: unknown) => Promise<Result<unknown>>;

export function createWriteGuard(): WriteGuard {
  let tail: Promise<unknown> = Promise.resolve();
  const exclusively = <T,>(work: () => Promise<T>): Promise<T> => {
    const next = tail.then(work, work);
    tail = next.catch(() => undefined);
    return next;
  };

  return async (ctx, tool, args) => {
    const mode = tool.write;
    if (mode === false) return tool.run(args as never, ctx);

    return exclusively(async () => {
      await flushed(ctx);
      const { session } = ctx;

      if (mode.kind === 'travel') {
        const result = await tool.run(args as never, ctx).catch(crashed);
        if (result.ok) ctx.notify(result.value as HistoryResult);
        return result;
      }

      const history = session.history;
      const stepBefore = history.peekUndo()?.id ?? null;
      const revisionBefore = session.revision();
      const token = history.begin(mode.label(args));
      let result: Result<unknown>;
      try {
        result = await tool.run(args as never, ctx);
      } catch (error) {
        result = crashed(error);
      } finally {
        history.end(token);
      }

      const list = history.list(describeStep);
      const step = history.peekUndo();
      if (step && step.id !== stepBefore) {
        ctx.notify(resultOfSteps(session, [{ step, skip: new Set() }], 'redo', [], list));
      } else if (session.revision() !== revisionBefore) {
        // A change that is not a step (a quest marked exported): the window reloads its canvas
        ctx.notify({ step: null, direction: 'redo', quests: [], positions: true, world: null, entities: null, name: false, skipped: [], history: list });
      }
      return result;
    });
  };
}
