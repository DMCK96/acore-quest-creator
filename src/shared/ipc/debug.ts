import type { Result } from './result';

export type DebugSource = 'main' | 'renderer';

/** One entry of the debug timeline; `t` is milliseconds since Debug mode was switched on */
export interface DebugEvent {
  t: number;
  source: DebugSource;
  category: string;
  name: string;
  data: Record<string, unknown>;
}

/** An event as a recorder is handed it; `at` is epoch milliseconds */
export interface DebugEventInput {
  at: number;
  category: string;
  name: string;
  data?: Record<string, unknown>;
}

export interface DebugEventQuery {
  since?: number;
  categories?: string[];
  limit?: number;
}

/** What main knows about the window */
export interface WindowState {
  focused: boolean;
  contentsFocused: boolean;
  visible: boolean;
  minimized: boolean;
}

/** What the page knows about keyboard focus right now */
export interface FocusSnapshot {
  documentHasFocus: boolean;
  active: string | null;
  activeState: { editable: boolean; disabled: boolean; readOnly: boolean } | null;
  blockedBy: string[];
  modals: string[];
  coveredBy: string | null;
}

export interface FieldState {
  target: string;
  value: string;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A question main asks the page */
export type RendererQuery = { kind: 'snapshot'; includeValue: boolean } | { kind: 'rect'; selector: string };
export type RendererRequest = RendererQuery & { id: number };
export type RendererAnswer = { focus: FocusSnapshot; field: FieldState | null } | { rect: Rect | null };

export interface DebugStatus {
  enabled: boolean;
  events: number;
  capacity: number;
  logFile: string | null;
  logFailures: number;
  logTruncated: boolean;
  window: WindowState | null;
}

export interface DebugSnapshot {
  main: WindowState | null;
  renderer: FocusSnapshot | null;
  rendererAnswered: boolean;
}

export interface DebugTypeResult {
  typed: number;
  before: FieldState | null;
  after: FieldState | null;
  changed: boolean;
  window: WindowState | null;
  events: DebugEvent[];
}

export interface ScreenshotOptions {
  selector?: string;
  rect?: Rect;
  maxWidth?: number;
}

export interface ScreenshotResult {
  width: number;
  height: number;
  mimeType: 'image/png';
  /** base64 */
  data: string;
  window: WindowState | null;
}

/** Debug mode: a timeline of both processes, and probes of the live window */
export interface DebugApi {
  debugStatus(): Promise<Result<DebugStatus>>;
  /** Only the user's Preferences switch calls this; no MCP tool may. */
  debugSetEnabled(on: boolean): Promise<Result<DebugStatus>>;
  debugEvents(query?: DebugEventQuery): Promise<Result<DebugEvent[]>>;
  debugSnapshot(): Promise<Result<DebugSnapshot>>;
  debugType(text: string): Promise<Result<DebugTypeResult>>;
  captureScreenshot(options?: ScreenshotOptions): Promise<Result<ScreenshotResult>>;
  /** The window hands over a batch of the events its taps saw. No MCP tool may call this. */
  debugRecord(batch: DebugEventInput[]): Promise<Result<null>>;
  /** The window answers a question main asked it. No MCP tool may call this. */
  debugAnswer(id: number, answer: RendererAnswer): Promise<Result<null>>;
}
