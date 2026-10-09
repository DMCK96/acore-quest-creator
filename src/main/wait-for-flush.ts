export interface FlushRequest {
  /** Registers `done` to be called when the window has handed over its edits; returns how to take it off again. */
  listen(done: () => void): () => void;
  /** Asks the window to hand them over. */
  send(): void;
  /** Stop waiting after this long; without it, wait for the window however long it takes. */
  timeoutMs?: number;
}

/** Asks a window for its pending edits and waits for its answer, never leaving a listener behind. */
export function waitForFlush({ listen, send, timeoutMs }: FlushRequest): Promise<void> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (): void => {
      clearTimeout(timer);
      unlisten();
      resolve();
    };
    const unlisten = listen(finish);
    if (timeoutMs !== undefined) timer = setTimeout(finish, timeoutMs);
    send();
  });
}
