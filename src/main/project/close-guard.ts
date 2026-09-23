import type { ProjectController } from './controller';

/** How long a close waits for the renderer to hand over its debounced edits before going ahead. */
export const FLUSH_TIMEOUT_MS = 2000;

const APP_NAME = 'ACORE Quest Creator';

export function windowTitle(name: string, dirty: boolean): string {
  return `${name}${dirty ? ' •' : ''} — ${APP_NAME}`;
}

/**
 * What closing the window does: collect the renderer's pending edits (so the unsaved check sees
 * them), ask about unsaved changes, and once the user has settled them drop the recovery copy,
 * since nothing is left to recover. Resolves true when the window may close.
 */
export function createCloseGuard(deps: {
  flush(): Promise<void>;
  projects: ProjectController;
  timeoutMs?: number;
}): () => Promise<boolean> {
  return async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, deps.timeoutMs ?? FLUSH_TIMEOUT_MS);
    });
    // A renderer that fails or never answers must not keep the window open forever.
    await Promise.race([deps.flush().catch(() => undefined), timeout]);
    clearTimeout(timer);
    if (!(await deps.projects.settleUnsaved())) return false;
    await deps.projects.discardOnQuit();
    return true;
  };
}
