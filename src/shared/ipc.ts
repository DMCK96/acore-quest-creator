import { z } from 'zod';
import type { RefKind } from '@core/db/types';
import type { EntityHit, QuestSummary, SearchKind } from '@core/db/world-db';
import type { PatchWarning } from '@core/export/build-patch';
import type { UnmodelledColumn } from '@core/import/unmodelled';
import type { UnavailableComponent } from '@core/links/availability';
import type { ComponentId, ComponentInstance } from '@core/links/model';
import type { QuestAggregate } from '@core/model/aggregate';
import type { FieldValue } from '@core/registry/types';
import type { Difference } from '@core/roundtrip/compare';
import type { ForeignScene } from '@core/scripts/decompile';
import type { CustomNpc, CustomObject } from '@core/entities/model';
import type { FidelityReport } from '@core/roundtrip/verify';
import type { SchemaDiff } from '@core/schema/diff';
import type { Issue } from '@core/validate/validate';

/**
 * The contract between the main process and the renderer: the `Api` types plus the zod schemas
 * that validate every call as it crosses the wire.
 *
 * Only zod is pulled in, so the renderer, the preload and the main process can all import this
 * without dragging in MySQL, SQLite or Node.
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
  /** The connection is fine; the database user lacks a grant the tool needs. */
  | 'PERMISSION'
  /** The server refused a query for a reason that is neither the connection nor a grant. */
  | 'QUERY'
  | 'NO_DEV_PROFILE'
  | 'CONFIRMATION_REQUIRED'
  | 'BAD_REQUEST'
  | 'BLOCKING_DRIFT'
  /** A project or recovery file could not be read, or is not a project this tool can open. */
  | 'PROJECT_FILE'
  /** Writing the project file failed; the work is still open and unsaved. */
  | 'SAVE_FAILED'
  | 'INVALID_NAME'
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
  /** The server's data folder (`DataDir`, holding `dbc/`), optional; '' or absent for none. */
  dbcDir?: string;
}

/** Saving a profile: an update (`id` given) may leave `password` out to keep the stored one. */
export type ProfileSave = Omit<ProfileInput, 'password'> & { id?: number; password?: string };

export interface ProfileRecord {
  id: number;
  name: string;
  role: 'world' | 'dev';
  host: string;
  port: number;
  user: string;
  database: string;
  /** '' when the profile names no server data folder. */
  dbcDir: string;
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

/** The open project as the renderer sees it: what the title bar and the Project modal show. */
export interface ProjectState {
  name: string;
  /** The file the project was last saved to or opened from; null while it has never been saved. */
  filePath: string | null;
  /** Changes since the last save. */
  dirty: boolean;
  idRangeStart: number;
  idRangeEnd: number;
  outputDir: string;
  viewport: Viewport;
}

/** A project file opened or saved lately; `exists` is false once the file has gone. */
export interface RecentProject {
  path: string;
  name: string;
  openedAt: string;
  exists: boolean;
}

/** New, Open and Save can each be cancelled by the user part way; `done` says whether it happened. */
export interface ProjectActionResult {
  done: boolean;
}

/** Unsaved work a crash left behind, offered back on the next launch. */
export interface RecoveryEntry {
  id: string;
  name: string;
  /** The file the work belonged to, or null when it had never been saved. */
  recoveredFrom: string | null;
  writtenAt: string;
  questCount: number;
  /** The file could not be read; it can only be discarded. */
  damaged: boolean;
}

export interface ConnectSummary {
  profileId: number;
  schemaHash: string;
  drift: SchemaDiff;
  /** True when a table every quest needs is missing: the fork cannot be worked with as it is. */
  blocking: boolean;
  /** What was read from the profile's server data folder; null when it names none. */
  serverData: ServerDataStatus | null;
}

/** The optional server data folder: the files read from it and what went wrong with the rest. */
export interface ServerDataStatus {
  dir: string;
  loaded: string[];
  problems: string[];
}

export interface OpenResult {
  questId: number;
  aggregate: QuestAggregate;
  fidelity: FidelityReport;
  unmodelled: UnmodelledColumn[];
  issues: Issue[];
  /** True when the quest was already in the open project, rather than imported by this call. */
  inProject: boolean;
  /** True when the world DB changed under the quest since it was imported. */
  stale: boolean;
  /**
   * The locale codes this quest has translated rows for. Non-empty means an enUS edit leaves those
   * translations stale, which the editor has to say out loud (spec §4.3).
   */
  locales: string[];
  /** Field id -> the translatable English text as imported, so the UI can spot a live edit. */
  importedText: Record<string, FieldValue>;
}

/** A whole quest chain added to the canvas at once. */
export interface ChainResult {
  /** The quest that was picked, opened for editing exactly as `openQuest` would. */
  open: OpenResult;
  /** Every quest of the chain, including ones that were already on the canvas. */
  questIds: number[];
  /** The chain was longer than one add will take, so only part of it was placed. */
  truncated: boolean;
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
  /** The quest-to-quest edges that leave this node, one per target and component. */
  links: NodeLink[];
  /** What offers this quest, as badges in a fixed order so the node never reshuffles them. */
  starts: StartBadge[];
  /** The quest groups this node belongs to. */
  groups: NodeGroup[];
  /** Linked quests that exist in the world but are not drawn, so the user knows the chain goes on. */
  offCanvasLinks: number;
  /** Shares no edge with any other quest on the canvas; also counted in `warnings`. */
  notConnected: boolean;
}

/** How a quest is offered, reduced to the few kinds a canvas node has room to show. */
export type StartBadge = 'npc' | 'object' | 'event' | 'item' | 'script' | 'backend';

/** One edge leaving a node; `owner` is the quest whose rows carry it, which is where it is edited. */
export interface NodeLink {
  to: number;
  component: ComponentId;
  owner: number;
}

export interface NodeGroup {
  group: number;
  kind: 'pickOne' | 'finishAll';
}

/** A component instance with the words the links panel shows for it. */
export interface LinkView extends ComponentInstance {
  label: string;
  summary: string;
}

/** A script row that names a quest but that no component explains. */
export interface UnrecognisedView {
  questId: number;
  key: string;
  summary: string;
}

export interface QuestLinks {
  instances: LinkView[];
  unrecognised: UnrecognisedView[];
  /** Components the connected database cannot support, and why, so their absence is explained. */
  unavailable: UnavailableComponent[];
}

export type AllocKind = 'creature' | 'gameobject' | 'creatureSpawn' | 'gameobjectSpawn' | 'page';

/** Fields an existing NPC or object lends a new one. */
export type EntityTemplate = Partial<Omit<CustomNpc, 'entry' | 'spawns'>> | Partial<Omit<CustomObject, 'entry' | 'spawns'>>;

/** What the Scripts module shows beside the quest's own scenes. */
export interface QuestScriptsInfo {
  /** Scripts on the quest's NPCs, objects and areas that the tool did not write. */
  foreign: ForeignScene[];
  /** Scenes the tool wrote before whose stored data can no longer be read; their rows are left alone. */
  unreadable: string[];
  /** Script tables the connected database lacks. */
  missingTables: string[];
}

/** Everything the renderer can ask the main process to do. */
export interface Api {
  testConnection(i: ProfileInput): Promise<Result<{ ok: true }>>;
  saveProfile(i: ProfileSave): Promise<Result<ProfileRecord>>;
  listProfiles(): Promise<Result<ProfileRecord[]>>;
  /** The profile to connect to without asking, seeded from `.env` in development; else null. */
  startupProfile(): Promise<Result<number | null>>;
  connect(profileId: number): Promise<Result<ConnectSummary>>;
  /** Shows a folder picker for the server data folder; null when cancelled. */
  chooseServerDataDir(): Promise<Result<string | null>>;
  searchQuests(text: string): Promise<Result<QuestSummary[]>>;
  /** Items, NPCs, objects or quests whose name contains the text, or whose ID is it. */
  searchEntities(kind: SearchKind, text: string): Promise<Result<EntityHit[]>>;
  openQuest(questId: number, position?: NodePosition): Promise<Result<OpenResult>>;
  newQuest(position?: NodePosition): Promise<Result<OpenResult>>;
  /** Imports the quest and every quest chained to it; `position` is where the picked quest lands. */
  addQuestChain(questId: number, position?: NodePosition): Promise<Result<ChainResult>>;
  listNodes(): Promise<Result<CanvasNode[]>>;
  moveNodes(moves: { questId: number; x: number; y: number }[]): Promise<Result<true>>;
  removeNode(questId: number): Promise<Result<true>>;
  saveViewport(v: Viewport): Promise<Result<true>>;
  lookupNames(kind: RefKind, ids: number[]): Promise<Result<Record<number, string>>>;
  /** Every quest link touching these quests, described, with the rows no component explains. */
  questLinks(questIds: number[]): Promise<Result<QuestLinks>>;
  /** The XP and money a quest of this level rewards, one entry per reward index. */
  rewardTables(level: number): Promise<Result<{ xp: (number | null)[]; money: (number | null)[] }>>;
  /** Replaces the open project's copy of the quest with the edited aggregate. */
  updateQuest(aggregate: QuestAggregate): Promise<Result<true>>;
  previewChanges(questId: number): Promise<Result<Difference[]>>;
  validate(questId: number): Promise<Result<Issue[]>>;
  /** Fresh IDs for new NPCs, objects or their spawns: above the database and every quest in the project. */
  allocateIds(kind: AllocKind, count: number): Promise<Result<number[]>>;
  /** The look and stats of an existing NPC or object, to start a new one from; null when there is none. */
  entityTemplate(kind: 'creature' | 'gameobject', entry: number): Promise<Result<EntityTemplate | null>>;
  /** The scripts around the quest that the Scripts module lists read-only. */
  questScripts(questId: number): Promise<Result<QuestScriptsInfo>>;
  exportQuest(questId: number): Promise<Result<ExportResult>>;
  applyToDev(questId: number, confirm: boolean): Promise<Result<{ statements: number }>>;
  projectState(): Promise<Result<ProjectState>>;
  renameProject(name: string): Promise<Result<true>>;
  /** Asks about unsaved changes first; `done` is false when the user cancelled. */
  newProject(name: string): Promise<Result<ProjectActionResult>>;
  /** Without a path, shows the open dialog. */
  openProject(path?: string): Promise<Result<ProjectActionResult>>;
  saveProject(): Promise<Result<ProjectActionResult>>;
  saveProjectAs(): Promise<Result<ProjectActionResult>>;
  recentProjects(): Promise<Result<RecentProject[]>>;
  forgetRecent(path: string): Promise<Result<true>>;
  recoveries(): Promise<Result<RecoveryEntry[]>>;
  restoreRecovery(id: string): Promise<Result<true>>;
  discardRecovery(id: string): Promise<Result<true>>;
}

/**
 * Request validation.
 *
 * Every argument list that arrives over IPC is untrusted, so each method gets a tuple schema and
 * nothing reaches `createApi` until it matches. The schemas guard shape, not policy: a quest ID of
 * `0` or `-5` is a well-formed request that the API answers with its own `INVALID_QUEST_ID`, and
 * only genuinely malformed input becomes `BAD_REQUEST`.
 *
 * zod rejects `NaN` and `Infinity` for `z.number()`, so every number below is finite by
 * construction; coordinates therefore cannot poison the stored canvas.
 */

// The method and channel names live in a zod-free module so the sandboxed preload can import them.
export { API_METHODS, channelFor } from './api-methods';

const REF_KINDS = [
  'item',
  'creature',
  'gameobject',
  'quest',
  'spell',
  'faction',
  'title',
  'areatrigger',
  'map',
  'emote',
  'zone',
  'skill',
  'mailTemplate',
] as const;

// Fails to compile if `RefKind` gains a member that the wire schema does not accept.
type Exactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _refKindsAreComplete: Exactly<(typeof REF_KINDS)[number], RefKind> = true;
void _refKindsAreComplete;

/** Search text is bounded so a runaway renderer cannot hand MySQL a megabyte-long LIKE. */
const MAX_SEARCH_TEXT = 200;
/** One lookup covers a whole canvas of quests; beyond this the caller is not asking a question. */
const MAX_LOOKUP_IDS = 5000;
/** A drag never moves more nodes than a project holds. */
const MAX_MOVES = 500;
/** Project names, file paths and recovery ids: generous, and only there to refuse garbage. */
const MAX_PROJECT_NAME = 200;
const MAX_PATH = 4096;
const MAX_RECOVERY_ID = 100;

const positionSchema = z.object({ x: z.number(), y: z.number() });
const viewportSchema = z.object({ x: z.number(), y: z.number(), zoom: z.number().positive() });

const profileFields = {
  name: z.string(),
  role: z.enum(['world', 'dev']),
  host: z.string(),
  port: z.number().int(),
  user: z.string(),
  database: z.string(),
  password: z.string(),
  dbcDir: z.string().optional(),
};
// Strict: a misspelled key must be a loud error, never a silently unsaved connection setting.
const profileInputSchema = z.object(profileFields).strict();
const profileSaveSchema = z
  .object({ ...profileFields, id: z.number().int().optional(), password: z.string().optional() })
  .strict()
  .refine((p) => p.id !== undefined || p.password !== undefined, { message: 'a new profile needs a password' });

const aggregateSchema = z
  .object({
    questId: z.number(),
    isNew: z.boolean(),
    // Field values are registry-shaped and checked by the registry, not here.
    values: z.record(z.string(), z.unknown()),
    readOnly: z.array(z.object({ fieldId: z.string(), reason: z.string() })),
    sharedItems: z.record(z.string(), z.array(z.number())),
  })
  .strict();

/**
 * One tuple schema per method, in `Api` declaration order.
 *
 * The `Record<keyof Api, ...>` annotation is the completeness check: a method added to `Api`
 * without a schema, or a schema for a method that no longer exists, fails to compile.
 */
const REQUEST_SCHEMAS: Record<keyof Api, z.ZodType<unknown[]>> = {
  testConnection: z.tuple([profileInputSchema]),
  saveProfile: z.tuple([profileSaveSchema]),
  listProfiles: z.tuple([]),
  startupProfile: z.tuple([]),
  chooseServerDataDir: z.tuple([]),
  connect: z.tuple([z.number()]),
  searchQuests: z.tuple([z.string().max(MAX_SEARCH_TEXT)]),
  searchEntities: z.tuple([z.enum(['item', 'creature', 'gameobject', 'quest']), z.string().max(MAX_SEARCH_TEXT)]),
  openQuest: z.tuple([z.number(), positionSchema.optional()]),
  newQuest: z.tuple([positionSchema.optional()]),
  addQuestChain: z.tuple([z.number(), positionSchema.optional()]),
  listNodes: z.tuple([]),
  moveNodes: z.tuple([
    z.array(z.object({ questId: z.number(), x: z.number(), y: z.number() })).max(MAX_MOVES),
  ]),
  removeNode: z.tuple([z.number()]),
  saveViewport: z.tuple([viewportSchema]),
  lookupNames: z.tuple([z.enum(REF_KINDS), z.array(z.number()).max(MAX_LOOKUP_IDS)]),
  questLinks: z.tuple([z.array(z.number()).max(MAX_LOOKUP_IDS)]),
  rewardTables: z.tuple([z.number()]),
  updateQuest: z.tuple([aggregateSchema]),
  previewChanges: z.tuple([z.number()]),
  validate: z.tuple([z.number()]),
  questScripts: z.tuple([z.number()]),
  allocateIds: z.tuple([z.enum(['creature', 'gameobject', 'creatureSpawn', 'gameobjectSpawn', 'page']), z.number().int().min(1).max(50)]),
  entityTemplate: z.tuple([z.enum(['creature', 'gameobject']), z.number().int()]),
  exportQuest: z.tuple([z.number()]),
  applyToDev: z.tuple([z.number(), z.boolean()]),
  projectState: z.tuple([]),
  renameProject: z.tuple([z.string().max(MAX_PROJECT_NAME)]),
  newProject: z.tuple([z.string().max(MAX_PROJECT_NAME)]),
  openProject: z.tuple([z.string().max(MAX_PATH).optional()]),
  saveProject: z.tuple([]),
  saveProjectAs: z.tuple([]),
  recentProjects: z.tuple([]),
  forgetRecent: z.tuple([z.string().max(MAX_PATH)]),
  recoveries: z.tuple([]),
  restoreRecovery: z.tuple([z.string().max(MAX_RECOVERY_ID)]),
  discardRecovery: z.tuple([z.string().max(MAX_RECOVERY_ID)]),
};

/**
 * Validates one call's arguments. The returned `args` are the parsed values, so unknown keys are
 * already gone by the time the API sees them.
 */
export function parseRequest(
  method: keyof Api,
  args: unknown[],
): { ok: true; args: unknown[] } | { ok: false; error: ApiError } {
  const schema = REQUEST_SCHEMAS[method];
  if (!schema) {
    return { ok: false, error: { code: 'BAD_REQUEST', message: `Unknown API method '${String(method)}'.` } };
  }
  const parsed = schema.safeParse(args);
  if (parsed.success) return { ok: true, args: [...parsed.data] };

  const issue = parsed.error.issues[0];
  const where = issue && issue.path.length > 0 ? ` at argument ${issue.path.join('.')}` : '';
  return {
    ok: false,
    error: { code: 'BAD_REQUEST', message: `${method}${where}: ${issue?.message ?? 'invalid request'}` },
  };
}
