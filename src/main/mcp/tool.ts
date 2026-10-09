import type { z } from 'zod';
import type { Api, ConnectSummary, Result } from '../../shared/ipc';
import type { HistoryResult } from '../../shared/history';
import type { ProjectSession } from '../project/session';

/** What a tool can reach. Tools go through `call` (validated like the window's calls), never `api`. */
export interface McpContext {
  api: Api;
  session: ProjectSession;
  /** One API call with its arguments validated and its failures turned into a `Result`. */
  call<M extends keyof Api>(method: M, ...args: Parameters<Api[M]>): ReturnType<Api[M]>;
  /** Asks the window to hand over any pending edit; resolves at once when there is no window. */
  flush(): Promise<void>;
  /**
   * Tells the window an AI client's write is about to run (`true`) or is over (`false`). Between the two
   * the window keeps its own quest edits back, so a copy of the quest older than the write cannot be
   * sent over it; what was typed meanwhile is put on top of the change when it arrives.
   */
  holdEdits?(held: boolean): void;
  /** Tells the window what changed in the project, so it shows the project as it now is. */
  notify(change: HistoryResult): void;
  /** Tells the window it was connected, so it leaves the login screen. */
  notifyConnected(summary: ConnectSummary): void;
  /** How long to wait for `flush` before going on; 5000 when absent. */
  flushTimeoutMs?: number;
  /** How long a write tool may run before it is given up on; 120000 when absent. */
  toolTimeoutMs?: number;
}

/**
 * How a tool changes the project.
 * `false`: it only reads. `step`: its changes are one undo step with this label.
 * `travel`: it is an undo or redo, so it makes no step of its own and hands the window its result.
 */
export type WriteMode = false | { kind: 'step'; label(args: any): string } | { kind: 'travel' };

export interface ToolDef<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  input: S;
  write: WriteMode;
  run(args: z.infer<z.ZodObject<S>>, ctx: McpContext): Promise<Result<unknown>>;
  /** Shortens a successful value for the model; the write guard still sees the raw value. */
  present?(value: any): unknown;
}

/** Identity, so `run` gets its `args` typed from `input`. */
export const defineTool = <S extends z.ZodRawShape>(def: ToolDef<S>): ToolDef => def as unknown as ToolDef;
