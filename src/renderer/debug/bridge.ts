import type { Api, DebugEventInput, RendererRequest } from '@shared/ipc';
import { fieldState, focusSnapshot, rectOf } from './focus-snapshot';
import { frameStats } from './frame-stats';
import { attachTaps } from './taps';
import { cameraHandle } from '../world3d/camera-handle';

const DEFAULT_FLUSH_MS = 250;
/** The most events one `debugRecord` call may carry */
const MAX_BATCH = 500;

/**
 * Joins the window to Debug mode. It asks the main process on every start whether the switch is on (a
 * reload or crash must not trust an old push), attaches the recorders while it is, sends what they see
 * in batches, and answers the questions main asks the page. It answers those whether or not Debug mode
 * is on, so a probe never waits on a quiet window. Returns the function that stops it.
 */
export function startDebugBridge(options: {
  api: Pick<Api, 'debugStatus' | 'debugRecord' | 'debugAnswer'>;
  events: { onDebugChanged?(handler: (on: boolean) => void): void; onDebugRequest?(handler: (request: RendererRequest) => void): void };
  win: Window;
  flushMs?: number;
}): () => void {
  const { api, events, win } = options;
  // Where a test mounts the app without the debug part of the bridge there is nothing to join
  if (typeof api.debugStatus !== 'function') return () => {};
  const flushMs = options.flushMs ?? DEFAULT_FLUSH_MS;
  const doc = win.document;

  let detachTaps: (() => void) | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let queue: DebugEventInput[] = [];
  let stopped = false;
  let pushed = false;

  const flush = (): void => {
    while (queue.length > 0) {
      const batch = queue.splice(0, MAX_BATCH);
      try {
        void Promise.resolve(api.debugRecord(batch)).catch(() => {});
      } catch {
        // a failing call must never reach the page
      }
    }
  };
  const flushWhenHidden = (): void => {
    if (doc.visibilityState === 'hidden') flush();
  };

  const attach = (): void => {
    if (detachTaps || stopped) return;
    const report = (event: DebugEventInput): void => void queue.push(event);
    const now = (): number => performance.timeOrigin + performance.now();
    detachTaps = attachTaps({ win, report, now });
    // The 3D view's frame stats ride on the same switch, queue and clock
    frameStats.attach(report, now);
    timer = setInterval(flush, flushMs);
    doc.addEventListener('visibilitychange', flushWhenHidden);
  };
  const detach = (): void => {
    detachTaps?.();
    detachTaps = null;
    frameStats.detach();
    if (timer) clearInterval(timer);
    timer = null;
    doc.removeEventListener('visibilitychange', flushWhenHidden);
    queue = [];
  };

  events.onDebugChanged?.((on) => {
    pushed = true;
    if (on) attach();
    else detach();
  });
  events.onDebugRequest?.((request) => {
    const handle = cameraHandle();
    const answer =
      request.kind === 'snapshot'
        ? { focus: focusSnapshot(doc), field: fieldState(doc, request.includeValue) }
        : request.kind === 'camera'
          ? { camera: handle?.status() ?? null }
          : request.kind === 'teleport'
            ? { camera: handle?.teleport(request.target) ?? null }
            : { rect: rectOf(doc, request.selector) };
    try {
      void Promise.resolve(api.debugAnswer(request.id, answer)).catch(() => {});
    } catch {
      // ignored
    }
  });

  void Promise.resolve(api.debugStatus())
    .then((result) => {
      // A push that arrived while this was in flight is newer than this answer
      if (!pushed && result.ok && result.value.enabled) attach();
    })
    .catch(() => {});

  return () => {
    stopped = true;
    detach();
  };
}
