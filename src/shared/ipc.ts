import type { RefKind } from '@core/db/types';
import type { QuestSummary } from '@core/db/world-db';
import type { PatchWarning } from '@core/export/build-patch';
import type { UnmodelledColumn } from '@core/import/unmodelled';
import type { QuestAggregate } from '@core/model/aggregate';
import type { Difference } from '@core/roundtrip/compare';
import type { FidelityReport } from '@core/roundtrip/verify';
import type { SchemaDiff } from '@core/schema/diff';
import type { Issue } from '@core/validate/validate';

/**
 * The contract between the main process and the renderer: types only.
 *
 * Nothing here executes, so the renderer can import it without pulling in MySQL, SQLite or Node.
 * The zod schemas that validate these shapes on the wire arrive with the IPC bridge itself.
 */

export type ErrorCode =
  | 'NOT_CONNECTED'
  | 'INVALID_QUEST_ID'
  | 'QUEST_NOT_FOUND'
  | 'FIDELITY'
  | 'VALIDATION'
  | 'ID_COLLISION'
  | 'RANGE_EXHAUSTED'
  | 'CONNECTION'
  | 'NO_DEV_PROFILE'
  | 'CONFIRMATION_REQUIRED'
  | 'BAD_REQUEST'
  | 'BLOCKING_DRIFT'
  | 'UNKNOWN';

export interface ApiError {
  code: ErrorCode;
  message: string;
  /** Present on `VALIDATION`: what the user has to fix before the quest can be exported. */
  issues?: Issue[];
  /** Present on `FIDELITY`: the cells an unedited export would not reproduce. */
  differences?: Difference[];
}

/** Every call answers with one of these: the API never rejects for a fault the user can act on. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: ApiError };

/** Connection profiles. `password` only ever travels towards the main process. */
export interface ProfileInput {
  name: string;
  role: 'world' | 'dev';
  host: string;
  port: number;
  user: string;
  database: string;
  password: string;
}

export interface ProfileRecord {
  id: number;
  name: string;
  role: 'world' | 'dev';
  host: string;
  port: number;
  user: string;
  database: string;
}

export interface NodePosition {
  x: number;
  y: number;
}

/** The canvas pan and zoom, saved with the project. */
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface Project {
  id: number;
  name: string;
  idRangeStart: number;
  idRangeEnd: number;
  outputDir: string;
  viewport: Viewport;
}

export interface ConnectSummary {
  profileId: number;
  schemaHash: string;
  drift: SchemaDiff;
  /** True when a table every quest needs is missing: the fork cannot be worked with as it is. */
  blocking: boolean;
}

export interface OpenResult {
  questId: number;
  aggregate: QuestAggregate;
  fidelity: FidelityReport;
  unmodelled: UnmodelledColumn[];
  issues: Issue[];
  /** True when the aggregate came from a draft that already existed, not from this import. */
  hasDraft: boolean;
  /** True when the world DB changed under the draft since it was taken. */
  stale: boolean;
}

export interface ExportResult {
  path: string;
  sql: string;
  warnings: PatchWarning[];
  issues: Issue[];
}

/** One quest as the canvas draws it. */
export interface CanvasNode {
  questId: number;
  title: string;
  level: number;
  isNew: boolean;
  exported: boolean;
  /** The stored round-trip report is not ok: exporting this quest would lose data. */
  unsafe: boolean;
  errors: number;
  warnings: number;
  x: number;
  y: number;
}

/** Everything the renderer can ask the main process to do. */
export interface Api {
  testConnection(i: ProfileInput): Promise<Result<{ ok: true }>>;
  saveProfile(i: ProfileInput & { id?: number }): Promise<Result<ProfileRecord>>;
  listProfiles(): Promise<Result<ProfileRecord[]>>;
  connect(profileId: number): Promise<Result<ConnectSummary>>;
  searchQuests(text: string): Promise<Result<QuestSummary[]>>;
  openQuest(questId: number, position?: NodePosition): Promise<Result<OpenResult>>;
  newQuest(position?: NodePosition): Promise<Result<OpenResult>>;
  listNodes(): Promise<Result<CanvasNode[]>>;
  moveNodes(moves: { questId: number; x: number; y: number }[]): Promise<Result<true>>;
  removeNode(questId: number): Promise<Result<true>>;
  saveViewport(v: Viewport): Promise<Result<true>>;
  lookupNames(kind: RefKind, ids: number[]): Promise<Result<Record<number, string>>>;
  saveDraft(aggregate: QuestAggregate): Promise<Result<{ updatedAt: string }>>;
  previewChanges(questId: number): Promise<Result<Difference[]>>;
  validate(questId: number): Promise<Result<Issue[]>>;
  exportQuest(questId: number): Promise<Result<ExportResult>>;
  applyToDev(questId: number, confirm: boolean): Promise<Result<{ statements: number }>>;
  getProject(): Promise<Result<Project>>;
  updateProject(p: Project): Promise<Result<Project>>;
}
