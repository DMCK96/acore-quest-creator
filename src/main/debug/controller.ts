import type {
  CameraState,
  CameraTarget,
  DebugEvent,
  DebugEventInput,
  DebugEventQuery,
  DebugSnapshot,
  DebugStatus,
  DebugTypeResult,
  FieldState,
  Rect,
  RendererAnswer,
  RendererQuery,
  ScreenshotOptions,
  ScreenshotResult,
  WindowState,
} from '@shared/ipc';
import { fail } from '../api/errors';
import type { DebugLog } from './log-file';
import type { DebugRecorder } from './recorder';
import type { RendererLink } from './renderer-link';
import type { DebugSettings } from './settings';

/** What the controller needs from the real window; the Electron glue implements it */
export interface DebugWindowPort {
  state(): WindowState | null;
  /** The window's picture (optionally one rectangle of it) scaled to at most `maxWidth` wide, or null when it cannot be captured */
  capture(o: { rect?: Rect; maxWidth: number }): Promise<{ data: string; width: number; height: number } | null>;
  /** Real key events into whatever has focus */
  sendText(text: string): Promise<void>;
  /** Tells the page Debug mode went on or off */
  announce(enabled: boolean): void;
}

export interface DebugController {
  /** Applies the saved setting at launch */
  start(): Promise<void>;
  stop(): Promise<void>;
  status(): DebugStatus;
  setEnabled(on: boolean): Promise<DebugStatus>;
  events(query?: DebugEventQuery): DebugEvent[];
  snapshot(): Promise<DebugSnapshot>;
  type(text: string): Promise<DebugTypeResult>;
  screenshot(options?: ScreenshotOptions): Promise<ScreenshotResult>;
  /** Where the 3D view's camera is; works with Debug mode off */
  cameraStatus(): Promise<CameraState>;
  /** Takes the camera to a place and returns where it landed */
  cameraTeleport(target: CameraTarget): Promise<CameraState>;
  /** A batch of the page's own events */
  ingest(batch: DebugEventInput[]): void;
  /** The page's answer to a question main asked it */
  answer(id: number, answer: RendererAnswer): void;
  /** Main's own event; nothing is recorded while Debug mode is off */
  note(category: string, name: string, data?: Record<string, unknown>): void;
  onChange(listener: (enabled: boolean) => void): () => void;
}

const SCREENSHOT_WIDTH = 1600;
const DEFAULT_SETTLE_MS = 150;
const NOT_ON = 'Turn on Debug mode in Preferences first.';

export function createDebugController(options: {
  settings: DebugSettings;
  recorder: DebugRecorder;
  logs: { open(): Promise<DebugLog> };
  window: DebugWindowPort;
  link: RendererLink;
  settleMs?: number;
}): DebugController {
  const { settings, recorder, logs, window: port, link } = options;
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
  const listeners = new Set<(enabled: boolean) => void>();
  let log: DebugLog | null = null;
  // Switches are applied one at a time, in the order they were asked
  let queue: Promise<unknown> = Promise.resolve();

  const status = (): DebugStatus => ({
    enabled: recorder.enabled(),
    events: recorder.count(),
    capacity: recorder.capacity,
    logFile: log?.path ?? null,
    logFailures: log?.failures() ?? 0,
    logTruncated: log?.truncated() ?? false,
    window: port.state(),
  });

  const apply = async (on: boolean): Promise<void> => {
    if (on === recorder.enabled()) return;
    if (on) {
      try {
        log = await logs.open();
      } catch {
        log = null;
      }
      recorder.enable(log ?? undefined);
    } else {
      recorder.disable();
      const closing = log;
      log = null;
      await closing?.close();
    }
    port.announce(on);
    for (const listener of listeners) listener(on);
  };

  const requireOn = (): void => {
    if (!recorder.enabled()) throw fail('NOT_ENABLED', NOT_ON);
  };

  const look = async (includeValue: boolean): Promise<{ focus: DebugSnapshot['renderer']; field: FieldState | null; answered: boolean }> => {
    const answer = await link.ask({ kind: 'snapshot', includeValue });
    if (answer && 'focus' in answer) return { focus: answer.focus, field: answer.field, answered: true };
    return { focus: null, field: null, answered: false };
  };

  const askCamera = async (query: RendererQuery): Promise<CameraState> => {
    const answer = await link.ask(query);
    if (!answer) throw fail('BAD_REQUEST', 'The window did not answer; is the editor open?');
    if (!('camera' in answer) || !answer.camera) throw fail('BAD_REQUEST', 'The 3D view is not open, or that map cannot be shown. Open the World view and try again.');
    return answer.camera;
  };

  const controller: DebugController = {
    async start() {
      await (queue = queue.then(() => apply(settings.enabled())));
    },
    async stop() {
      const closing = log;
      log = null;
      await closing?.close();
    },
    status,
    async setEnabled(on) {
      settings.setEnabled(on);
      await (queue = queue.then(() => apply(on)));
      return status();
    },
    events: (query) => recorder.events(query),
    note: (category, name, data) => recorder.record('main', { category, name, data }),
    ingest(batch) {
      for (const event of batch) recorder.record('renderer', event);
    },
    answer: (id, answer) => link.answer(id, answer),
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async snapshot() {
      requireOn();
      const seen = await look(false);
      return { main: port.state(), renderer: seen.focus, rendererAnswered: seen.answered };
    },

    async type(text) {
      requireOn();
      const earlier = recorder.events().length;
      const before = (await look(true)).field;
      // The length only: what was typed is not kept
      controller.note('probe', 'type', { length: text.length });
      await port.sendText(text);
      if (settleMs > 0) await new Promise((resolve) => setTimeout(resolve, settleMs));
      const after = (await look(true)).field;
      const changed = before && after ? before.value !== after.value : before !== after;
      return { typed: text.length, before, after, changed, window: port.state(), events: recorder.events().slice(earlier) };
    },

    async cameraStatus() {
      return askCamera({ kind: 'camera' });
    },

    async cameraTeleport(target) {
      controller.note('probe', 'teleport', { ...target });
      return askCamera({ kind: 'teleport', target });
    },

    async screenshot(opts = {}) {
      const maxWidth = opts.maxWidth ?? SCREENSHOT_WIDTH;
      let rect = opts.rect;
      if (opts.selector) {
        const answer = await link.ask({ kind: 'rect', selector: opts.selector });
        rect = answer && 'rect' in answer ? (answer.rect ?? undefined) : undefined;
        if (!rect) throw fail('BAD_REQUEST', 'Nothing on screen matches that selector.');
      }
      const picture = await port.capture(rect ? { rect, maxWidth } : { maxWidth });
      if (!picture) throw fail('BAD_REQUEST', 'The window is hidden or minimised, so there is nothing to capture.');
      return { width: picture.width, height: picture.height, mimeType: 'image/png', data: picture.data, window: port.state() };
    },
  };
  return controller;
}
