import type { RendererAnswer, RendererQuery, RendererRequest } from '@shared/ipc';

/** Main asking the page a question and waiting a short while for the answer */
export interface RendererLink {
  /** Resolves with the page's answer, or null when there is no window or it does not answer in time */
  ask(query: RendererQuery): Promise<RendererAnswer | null>;
  /** The page's answer to a request; an unknown or already-expired id is ignored */
  answer(id: number, answer: RendererAnswer): void;
}

const DEFAULT_TIMEOUT_MS = 2000;

/** `send` hands a request to the window and says whether there was a window to hand it to */
export function createRendererLink(options: { send(request: RendererRequest): boolean; timeoutMs?: number }): RendererLink {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const waiting = new Map<number, { resolve(answer: RendererAnswer | null): void; timer: ReturnType<typeof setTimeout> }>();
  let next = 1;

  return {
    ask(query) {
      const id = next++;
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          waiting.delete(id);
          resolve(null);
        }, timeoutMs);
        waiting.set(id, { resolve, timer });
        if (!options.send({ ...query, id })) {
          clearTimeout(timer);
          waiting.delete(id);
          resolve(null);
        }
      });
    },
    answer(id, answer) {
      const entry = waiting.get(id);
      if (!entry) return;
      clearTimeout(entry.timer);
      waiting.delete(id);
      entry.resolve(answer);
    },
  };
}
