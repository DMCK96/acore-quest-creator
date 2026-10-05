import { join } from 'node:path';
import { SPAWN_VIEW_CAP } from '@core/db/view-spawns';
import { isDeepStrictEqual } from 'node:util';
import { layoutChain, NODE_GRID, nextNodePosition } from '../core/canvas/layout';
import type { DevDb } from '../core/db/dev-db';
import type { ColumnInfo, RawRow, RefKind, SchemaInfo } from '../core/db/types';
import { UnknownColumnError, UnknownTableError, type WorldDb } from '../core/db/world-db';
import { buildPatch, type PatchStatement, type PatchWarning } from '../core/export/build-patch';
import { findQuestGiverFixes, type QuestGiverFix } from '../core/export/quest-giver';
import { patchFileName, renderPatch, renderStatement } from '../core/export/render-patch';
import { allocateQuestId, assertIdFree, collectTakenIds } from '../core/ids/allocator';
import { defaultColumnValues, importQuest } from '../core/import/importer';
import { fetchLinkedContext } from '../core/import/linked-context';
import { createNewAggregate } from '../core/import/new-quest';
import { findQuestChain, MAX_CHAIN_QUESTS } from '../core/import/quest-chain';
import { listUnmodelled } from '../core/import/unmodelled';
import { componentAvailability, type Availability } from '../core/links/availability';
import { componentById } from '../core/links/catalog';
import type { NameBook, NameKind } from '../core/links/component';
import { CONTEXT_TABLES, readItemStarters, rowsOrNone, type ItemStarter } from '../core/links/context';
import { disconnectedQuests, linkIssues } from '../core/links/issues';
import { questEdges, type ComponentId, type Endpoint } from '../core/links/model';
import { loadLinks, type LinkSnapshot } from '../core/links/service';
import type { QuestAggregate, Snapshot } from '../core/model/aggregate';
import { localesInSnapshot, localizedTextValues } from '../core/model/locales';
import { registry } from '../core/registry';
import { actionName, describeEvent } from '../core/smartai/ids';
import { sourceEndpoint } from '../core/links/components/smartai';
import { endpointName } from '../core/links/describe';
import { applyPatchInMemory, keyColumnsByTable } from '../core/roundtrip/apply';
import { compareTables, type Difference } from '../core/roundtrip/compare';
import { verifyRoundTrip, type FidelityReport } from '../core/roundtrip/verify';
import { diffSchema, hasBlockingDrift } from '../core/schema/diff';
import { loadSchema } from '../core/schema/load';
import { refCheckerFor, validateQuest, type Issue, type RefChecker } from '../core/validate/validate';
import { TOOL_VERSION } from '../core/version';
import { addSpawn, hasWorldChanges, isAdded, moveSpawn, movementsOf, revertMovement, revertRoute, revertSpawn, setMovement, setRoute, worldStatements, type RoutePoint, type SpawnDefaults, type WorldLayer } from '../core/world/layer';
import { IDLE } from '../core/world/movement';
import { describeStep } from './project/step-labels';
import type { HistoryStep } from './project/history';
import type { HistoryPart, HistoryResult, QuestEdit, StepSummary } from '../shared/history';
import { addedDrifted, countWalkers, routeWalkerName, movementDrifted, readMovement, readPlacement, readRoute, readTemplateLook, readWalkerEntries, routeDrifted, spawnDrifted, worldSchema } from './world/world-api';
import type {
  Api,
  ApiError,
  CanvasNode,
  ClientStatus,
  ErrorCode,
  NodeGroup,
  NodeLink,
  NodePosition,
  OpenResult,
  ProfileInput,
  ProjectState,
  QuestLinks,
  Result,
  MapInfo,
  QuestMapRef,
  QuestSpawn,
  QuestSpawnGroup,
  SpawnDot,
  SpellFactsResult,
  StartBadge,
} from '../shared/ipc';
import { floorsAt, navTileFileName, parseNavTile, type NavTile } from '../core/game/navmesh';
import { AREA_TABLE_FILE, MAP_FILE, parseMapNames, parseZoneLabels, WORLD_MAP_AREA_FILE } from '../core/game/maps-dbc';
import type { Store } from './store/store';
import { compileScenes, mergeCompiled, type CompiledScripts } from '../core/scripts/compile';
import { compileFights } from '../core/combat/compile';
import { fightIsEmpty } from '../core/combat/model';
import { SCRIPT_KEYS, SCRIPT_TABLES, listIdsOf, readScriptContext, taggedRows, type ScriptContext } from '../core/scripts/context';
import { foreignScenes, scenesFromRows } from '../core/scripts/decompile';
import { SCRIPTS_FIELD, readScenes, writeScenes, type QuestScene, type SceneOwner } from '../core/scripts/model';
import { scriptStatements } from '../core/scripts/statements';
import { sceneIssues } from '../core/scripts/validate';
import { compileEntities } from '../core/entities/compile';
import { compilePatrols, hasPointActions } from '../core/patrol/compile';
import { ENTITY_KEYS, ENTITY_TABLES, readEntityContext } from '../core/entities/context';
import { emptyGiversOf } from '../core/modules/givers';
import { narrowTo, objectivesOf, questItemsOf, questUses, relationOwners } from '../core/entities/links';
import { NPC_TYPE_VALUE, OBJECT_TYPE_VALUE, RANK_VALUE, projectEntitiesSchema, readProjectEntities, type ProjectEntities, type QuestEntities } from '../core/entities/model';
import { entityIssues } from '../core/entities/validate';
import { gmCommands } from '../core/testing/gm';
import { TerrainFormatError, gridFileName, parseMapFile, terrainHeight, type TerrainFile } from '../core/game/terrain';
import { loadServerData, readServerDataFile, type ServerData, type ServerDataFiles } from './server-data';
import { CAST_TIMES_FILE, RANGE_FILE, readSpellIndex, SPELL_FILE, spellDetail, spellLabel, type SpellIndex } from '../core/game/spells';
import { readSoundIndex, SOUND_FILE, type SoundIndex } from '../core/game/sounds';
import { QUEST_SORT_FILE, readQuestSorts, type QuestSortIndex } from '../core/game/quest-sorts';
import { DISPLAY_FILES, readCreatureDisplays, readObjectDisplays, type DisplayIndex } from '../core/game/displays';
import { FACTION_TEMPLATE_FILES, readFactionTemplates, type FactionTemplateIndex } from '../core/game/faction-templates';
import type { EntityHit, LookKind } from '../core/db/entity-search';
import type { ProjectQuest } from './project/project-file';
import type { ProjectSession } from './project/session';
import type { ProjectController } from './project/controller';

export type { DevDb };

export interface ApiDeps {
  store: Store;
  openWorldDb(p: ProfileInput): Promise<WorldDb>;
  openDevDb(p: ProfileInput): Promise<DevDb>;
  fs: {
    writeFile(path: string, text: string): Promise<void>;
    ensureDir(path: string): Promise<void>;
    listDir(path: string): Promise<string[]>;
  };
  now(): Date;
  /** The open project: every quest on the canvas lives here until the user saves it to a file. */
  session: ProjectSession;
  /** New, Open, Save and the rest of the project-file actions, which need no database. */
  projects: ProjectController;
  /** A profile to connect to on launch (seeded from `.env` in development). */
  startupProfileId?: number | null;
  /** Reads the optional server data folder; without it the folder is reported as unreadable. */
  serverDataFiles?: ServerDataFiles;
  /** The native folder picker; null when cancelled. */
  chooseDirectory?(): Promise<string | null>;
  /** The data folder for the quest map's grid and navmesh reads (listings cached); `serverDataFiles` otherwise. */
  mapDataFiles?: ServerDataFiles;
  /** Told the connection's server data folder at every connect (null when it names none), for the map tiles. */
  onServerDataDir?(dir: string | null): void;
  /** Told the connection's game client folder at every connect (null when it names none), for the map tiles. */
  onClientDir?(dir: string | null): void;
  /** What the game client folder given to `onClientDir` holds; the folder is opened now if it was not yet. */
  clientStatus?(): Promise<ClientStatus | null>;
  /** Where Export patch writes whatever the connection says (`ACQC_OUTPUT_DIR`, for tests). */
  exportDirOverride?: string | null;
  /** Where Export patch writes when the connection names no export folder. */
  defaultExportDir?: string;
}

const NO_SERVER_DATA_FILES: ServerDataFiles = { read: async () => null, isDir: async () => false };

/** The live world connection plus everything that was read from it once, at connect time. */
interface Session {
  profileId: number;
  /** The connection's export folder; null when it names none. */
  exportDir: string | null;
  db: WorldDb;
  schema: SchemaInfo;
  blocking: boolean;
  blockingTables: string[];
  /** Blocking tables the database has but will not show this user: a grant, not a missing table. */
  forbiddenTables: string[];
  /** The tables quest links read beyond the registry's, as the connected database has them. */
  contextTables: Record<string, ColumnInfo[]>;
  /** Which link components this database can carry, decided once so every call agrees. */
  availability: Availability;
  /** Every quest-starting item, read once here because asking `item_template` per link read is a full scan. */
  itemStarters: ItemStarter[];
  /** What the profile's server data folder added, read once at connect; null when it names none. */
  serverData: ServerData | null;
  /** The tables quest scripting writes, as this database has them. */
  scriptSchema: SchemaInfo;
  /** The spell list, loaded on the first spell search or lookup; a reason when there is none. */
  spells?: Promise<SpellIndex | { reason: string }>;
  /** The spell list once loaded, for checks that must not wait for or start a load. */
  spellsReady?: SpellIndex;
  /** Sound names, loaded on the first sound search or lookup; a reason when there are none. */
  sounds?: Promise<SoundIndex | { reason: string }>;
  questSorts?: Promise<QuestSortIndex>;
  /** Looks and factions for new NPCs and objects, each loaded on first use. */
  looks?: Partial<Record<LookKind, Promise<DisplayIndex | FactionTemplateIndex | { reason: string }>>>;
  /** Parsed navmesh tiles by file name (null when missing or unreadable), most recent last. */
  navTiles?: Map<string, NavTile | null>;
  /** The quest map's maps and zone names, read once per connection. */
  mapInfo?: Promise<MapInfo[]>;
}

/** The continents the quest map shows even when the server's own map list cannot be read. */
const CONTINENTS: readonly MapInfo[] = [
  { id: 0, name: 'Eastern Kingdoms', zones: [] },
  { id: 1, name: 'Kalimdor', zones: [] },
  { id: 530, name: 'Outland', zones: [] },
  { id: 571, name: 'Northrend', zones: [] },
];
const NAV_CACHE_SIZE = 64;
/** Spawn dots sent to the map per kind; more means the author should zoom in. */
const SPAWN_DOT_CAP = 2000;
const REF_SPAWNS_PER_ENTRY = 20;
/** Spawns of one NPC or object listed for jumping to in the 3D view; more is said, not given. */
const FIND_SPAWNS_LIMIT = 300;
/** Spawns listed per NPC or object a quest names, when its spawns are shown in the 3D view */
const QUEST_SPAWNS_PER_ENTRY = 200;

const REGISTRY_TABLES = registry.tables.map((t) => t.table);
const KEY_COLUMNS = keyColumnsByTable(registry);
const TITLE_FIELD = 'quest_template.LogTitle';
const LEVEL_FIELD = 'quest_template.QuestLevel';
const SEARCH_LIMIT = 50;
/** Picker results: enough to find a name, few enough to scan by eye. */
const ENTITY_SEARCH_LIMIT = 25;

const REWARD_TIERS = 10;
const REWARD_LEVEL_MIN = 1;
const REWARD_LEVEL_MAX = 80;
const INTEGER_TEXT = /^-?\d+$/;

/** Reads text that must be a plain integer; anything else (garbage, missing) is `null`. */
function parseRewardInt(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || !INTEGER_TEXT.test(raw)) return null;
  return Number(raw);
}

/**
 * Fetches the one row keyed by `level`, tolerating a table or column the connected schema does not
 * have at all (drift outside the registry): both come back as "no row", not an error.
 */
async function readRewardRow(
  db: WorldDb,
  table: string,
  keyColumn: string,
  level: number,
): Promise<RawRow | undefined> {
  try {
    const rows = await db.selectRows(table, { [keyColumn]: [String(level)] });
    return rows[0];
  } catch (error) {
    if (error instanceof UnknownTableError || error instanceof UnknownColumnError) return undefined;
    throw error;
  }
}

/** The table a quest-giver fix touches; it is outside the snapshot, so previews add it by hand. */
const CREATURE_TABLE = 'creature_template';
const QUEST_GIVER_BIT = 2;

/** An error the user can act on, already carrying the code the renderer switches on. */
class ApiFailure extends Error {
  constructor(readonly error: ApiError) {
    super(error.message);
    this.name = 'ApiFailure';
  }
}

const fail = (code: ErrorCode, message: string, extra: Omit<ApiError, 'code' | 'message'> = {}): ApiFailure =>
  new ApiFailure({ code, message, ...extra });

/** Named core errors become codes; anything else is a bug, reported as `UNKNOWN` with its message. */
function toApiError(error: unknown): ApiError {
  if (error instanceof ApiFailure) return error.error;
  const message = error instanceof Error ? error.message : String(error);
  const byName: Partial<Record<string, ErrorCode>> = {
    InvalidQuestIdError: 'INVALID_QUEST_ID',
    QuestNotFoundError: 'QUEST_NOT_FOUND',
    RangeExhaustedError: 'RANGE_EXHAUSTED',
    IdCollisionError: 'ID_COLLISION',
    InvalidRangeError: 'BAD_REQUEST',
    ProjectFileError: 'PROJECT_FILE',
    SaveFailedError: 'SAVE_FAILED',
    InvalidNameError: 'INVALID_NAME',
    WorldDbConnectionError: 'CONNECTION',
    // A missing grant is not a connection failure, and the message must not send the user to
    // check their host and port for a problem that lives in their GRANT statements.
    WorldDbPermissionError: 'PERMISSION',
    WorldDbQueryError: 'QUERY',
  };
  const code = error instanceof Error ? byName[error.name] : undefined;
  return { code: code ?? 'UNKNOWN', message };
}

async function run<T>(work: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    return { ok: false, error: toApiError(error) };
  }
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** `yyyy_mm_dd` in UTC, so the same export produces the same file name wherever it runs. */
const patchDate = (now: Date): string =>
  `${now.getUTCFullYear()}_${pad(now.getUTCMonth() + 1)}_${pad(now.getUTCDate())}`;

const textOf = (aggregate: QuestAggregate, fieldId: string): string => {
  const value = aggregate.values[fieldId];
  return typeof value === 'string' ? value : '';
};

const numberOf = (aggregate: QuestAggregate, fieldId: string): number => {
  const value = aggregate.values[fieldId];
  return typeof value === 'number' ? value : 0;
};

/**
 * The start components a canvas node shows as a badge, in the order the node draws them.
 * `start.offeredStraightAway` is missing on purpose: it comes from another quest, so it is an edge.
 */
const START_BADGES: readonly [ComponentId, StartBadge][] = [
  ['start.npc', 'npc'],
  ['start.object', 'object'],
  ['start.gameEvent', 'event'],
  ['start.item', 'item'],
  ['start.smartai', 'script'],
  ['start.backend', 'backend'],
];

const GROUP_KINDS: Partial<Record<ComponentId, NodeGroup['kind']>> = {
  'group.pickOne': 'pickOne',
  'group.finishAll': 'finishAll',
};

/** The world entity an endpoint names, when it is one the links panel can show a name for. */
function nameTarget(endpoint: Endpoint): [NameKind, number] | undefined {
  switch (endpoint.kind) {
    case 'quest':
      return ['quest', endpoint.questId];
    case 'creature':
    case 'gameobject':
    case 'item':
      return [endpoint.kind, endpoint.entry];
    default:
      return undefined;
  }
}

/**
 * The whole application, as one object of plain async functions.
 *
 * Every side effect arrives through `deps`, so the tests drive the real thing with an in-memory
 * world DB, an in-memory store and a fake file system. The Electron layer only wires the real
 * implementations in and forwards the calls over IPC.
 */
/** How many parsed terrain grids to keep: a quest's positions rarely span more than a few. */
const TERRAIN_CACHE_SIZE = 16;

export function createApi(deps: ApiDeps): Api {
  let session: Session | null = null;
  // The folders the map was last told, so a connect that fails part way can put them back.
  let folders: { dataDir: string | null; clientDir: string | null } = { dataDir: null, clientDir: null };
  const setFolders = (next: typeof folders): void => {
    folders = next;
    deps.onServerDataDir?.(next.dataDir);
    deps.onClientDir?.(next.clientDir);
  };
  const terrainCache = new Map<string, TerrainFile | null>();

  const connected = (): Session => {
    if (!session) throw fail('NOT_CONNECTED', 'Connect to a world database first.');
    return session;
  };

  /** A connection whose schema can actually carry a quest: drift that blocks is refused here. */
  const usable = (): Session => {
    const live = connected();
    if (!live.blocking) return live;
    const forbidden = live.blockingTables.filter((t) => live.forbiddenTables.includes(t));
    // "Missing" and "you may not read it" need different fixes, so they get different sentences.
    if (forbidden.length > 0) {
      throw fail(
        'PERMISSION',
        `The connected database has ${forbidden.join(', ')} but this user may not read ${forbidden.length > 1 ? 'them' : 'it'}. Grant it SELECT and reconnect.`,
      );
    }
    throw fail(
      'BLOCKING_DRIFT',
      `The connected database is missing ${live.blockingTables.join(', ')}, which every quest needs. Reconnect to a database that has it.`,
    );
  };

  const quests = deps.session.quests;
  const history = deps.session.history;
  /** Runs work as one step of the history, however many changes it makes */
  const asOneStep = async <T,>(work: () => Promise<T>): Promise<T> => {
    const token = history.begin();
    try {
      return await work();
    } finally {
      history.end(token);
    }
  };
  const historyList = () => history.list(describeStep);
  /** The spawns and new quests the steps would bring back that the database has taken since */
  const takenBy = async (steps: HistoryStep[], direction: 'undo' | 'redo'): Promise<Taken> => {
    const spawns = new Set<string>();
    const quests = new Set<number>();
    const entities = new Set<string>();
    const db = session?.db ?? null;
    if (!db) return { spawns, quests, entities };
    // NPCs, objects and items a step would bring back, and their spawns, walked like the world layer
    let store = deps.session.entities.get();
    const entityAsks: { key: string; kind: 'creature' | 'gameobject' | 'item'; entry: number; guids: number[] }[] = [];
    // Walked against the project as it will stand at each step, not the step's own other side
    let added = deps.session.world.get().added;
    const present = new Set(quests_present());
    const spawnAsks: { key: string; kind: WorldLayer['added'][number]['kind']; guid: number }[] = [];
    const questAsks: number[] = [];
    for (const step of steps) {
      for (const part of step.parts) {
        const to = direction === 'undo' ? part.before : part.after;
        if (part.kind === 'world') {
          const layer = to as WorldLayer;
          for (const a of layer.added) {
            const key = `${a.kind}:${a.guid}`;
            if (!added.some((b) => b.kind === a.kind && b.guid === a.guid) && !spawnAsks.some((x) => x.key === key)) spawnAsks.push({ key, kind: a.kind, guid: a.guid });
          }
          added = layer.added;
        } else if (part.kind === 'quest') {
          const quest = to as QuestEdit | null;
          if (quest && quest.isNew && !present.has(part.questId) && !questAsks.includes(part.questId)) questAsks.push(part.questId);
          if (quest) present.add(part.questId);
          else present.delete(part.questId);
        } else if (part.kind === 'entities') {
          const next = to as ProjectEntities;
          for (const [list, kind] of [['npcs', 'creature'], ['objects', 'gameobject'], ['items', 'item']] as const) {
            for (const e of next[list] as { entry: number; spawns?: { guid: number }[] }[]) {
              const key = `${list}:${e.entry}`;
              const had = (store[list] as { entry: number }[]).some((x) => x.entry === e.entry);
              if (!had && !entityAsks.some((x) => x.key === key)) entityAsks.push({ key, kind, entry: e.entry, guids: (e.spawns ?? []).map((sp) => sp.guid) });
            }
          }
          store = next;
        }
      }
    }
    for (const ask of spawnAsks) if ((await readPlacement(db, ask.kind, ask.guid)) !== null) spawns.add(ask.key);
    if (questAsks.length > 0) for (const id of await db.existingIds('quest', questAsks)) quests.add(id);
    for (const ask of entityAsks) {
      const template = (await db.existingIds(ask.kind, [ask.entry])).has(ask.entry);
      let spawned = false;
      if (!template && ask.kind !== 'item') {
        for (const guid of ask.guids) if ((await readPlacement(db, ask.kind, guid)) !== null) spawned = true;
      }
      if (template || spawned) entities.add(ask.key);
    }
    return { spawns, quests, entities };
  };
  const quests_present = (): number[] => quests.list().map((q) => q.questId);
  type Taken = { spawns: Set<string>; quests: Set<number>; entities: Set<string> };

  /** A layer without the placed spawns (and their movements) whose ids the database has taken */
  const withoutTaken = (layer: WorldLayer, taken: Set<string>): WorldLayer => {
    if (taken.size === 0) return layer;
    const gone = (kind: string, guid: number) => taken.has(`${kind}:${guid}`);
    return {
      ...layer,
      added: layer.added.filter((a) => !gone(a.kind, a.guid)),
      ...(layer.movements ? { movements: layer.movements.filter((m) => !gone('creature', m.guid)) } : {}),
    };
  };

  /**
   * An undo, redo or jump. The database is asked first, about what the steps would bring back; then,
   * with nothing awaited, the steps are taken from the history and applied, so no other change can
   * land in between. If the project changed while the database was asked, it is planned again.
   */
  const travel = async (
    plan: () => { direction: 'undo' | 'redo'; steps: HistoryStep[] },
    take: () => { direction: 'undo' | 'redo'; steps: HistoryStep[] },
  ): Promise<HistoryResult> => {
    for (let attempt = 0; ; attempt++) {
      history.endAll();
      const revision = deps.session.revision();
      const planned = plan();
      const taken = await takenBy(planned.steps, planned.direction);
      const again = plan();
      const same = again.steps.length === planned.steps.length && again.steps.every((st, i) => st.id === planned.steps[i]!.id);
      if ((!same || deps.session.revision() !== revision) && attempt < 3) continue;
      return applySteps(take(), taken);
    }
  };

  /** Applies steps in order, with nothing awaited, leaving out what the database has taken, and says what they changed */
  const applySteps = ({ direction, steps }: { direction: 'undo' | 'redo'; steps: HistoryStep[] }, taken: Taken): HistoryResult => {
    const verb = direction === 'undo' ? 'undo' : 'redo';
    const left = new Set<string>();
    const touched: number[] = [];
    let positions = false;
    let world = false;
    let entities = false;
    let name = false;
    let last: StepSummary | null = null;
    for (const step of steps) {
      const skip = new Set<number>();
      const parts = step.parts.map((part, i): HistoryPart => {
        if (part.kind === 'world') {
          const to = direction === 'undo' ? part.before : part.after;
          const kept = withoutTaken(to, taken.spawns);
          for (const a of to.added) if (!kept.added.includes(a)) left.add(`Could not ${verb}: spawn ${a.guid} is now in the database`);
          return direction === 'undo' ? { ...part, before: kept } : { ...part, after: kept };
        }
        if (part.kind === 'entities' && taken.entities.size > 0) {
          const to = direction === 'undo' ? part.before : part.after;
          const now = deps.session.entities.get();
          const kept: ProjectEntities = { npcs: [], objects: [], items: [] };
          for (const list of ['npcs', 'objects', 'items'] as const) {
            for (const e of to[list] as { entry: number; name: string }[]) {
              const back = !(now[list] as { entry: number }[]).some((x) => x.entry === e.entry);
              if (back && taken.entities.has(`${list}:${e.entry}`)) {
                const word = list === 'npcs' ? 'NPC' : list === 'objects' ? 'Object' : 'Item';
                left.add(`${e.name.trim() || `${word} ${e.entry}`} was left out: its ID is now used in the database.`);
                continue;
              }
              (kept[list] as unknown[]).push(e);
            }
          }
          return direction === 'undo' ? { ...part, before: kept } : { ...part, after: kept };
        }
        if (part.kind === 'quest') {
          const to = direction === 'undo' ? part.before : part.after;
          if (to && to.isNew && taken.quests.has(part.questId) && !quests.get(part.questId)) {
            left.add(`Could not ${verb}: quest ${part.questId} is now in the database`);
            skip.add(i);
          }
        }
        return part;
      });
      deps.session.applyStep({ ...step, parts }, direction, skip);
      step.parts.forEach((part, i) => {
        if (skip.has(i)) return;
        if (part.kind === 'quest') {
          if (!touched.includes(part.questId)) touched.push(part.questId);
          if (part.before === null || part.after === null) positions = true;
        } else if (part.kind === 'positions') positions = true;
        else if (part.kind === 'world') world = true;
        else if (part.kind === 'entities') entities = true;
        else name = true;
      });
      last = { id: step.id, ...describeStep(step) };
    }
    const layer = deps.session.world.get();
    return {
      step: last,
      direction,
      quests: touched.map((questId) => ({ questId, aggregate: quests.get(questId)?.aggregate ?? null })),
      positions,
      world: world ? { ...layer, movements: movementsOf(layer) } : null,
      entities: entities ? deps.session.entities.get() : null,
      name,
      skipped: [...left],
      history: historyList(),
    };
  };
  // Undo, redo and jump one at a time: Ctrl+Z held down sends them faster than they finish
  let travelling: Promise<unknown> = Promise.resolve();
  const queued = <T,>(work: () => Promise<T>): Promise<T> => {
    const next = travelling.then(work, work);
    travelling = next.catch(() => undefined);
    return next;
  };

  const questOf = (questId: number): ProjectQuest => {
    const quest = quests.get(questId);
    if (!quest) throw fail('QUEST_NOT_FOUND', `Quest ${questId} is not in this project.`);
    return quest;
  };

  const placeAt = (position?: NodePosition): NodePosition =>
    position ?? nextNodePosition(quests.list().map((q) => ({ x: q.x, y: q.y })));

  /** Every quest in the project: links are read from the user's edits, not the world, wherever one exists. */
  const projectAggregates = (): Map<number, QuestAggregate> =>
    new Map(quests.list().map((q) => [q.questId, q.aggregate]));

  /**
   * The items that start a quest: the database's, with the project's new items in place of any the
   * database has under the same entry (they replace it on export).
   */
  const withProjectStarters = (starters: readonly ItemStarter[]): ItemStarter[] => {
    const mine = projectEntities().items.filter((i) => i.startsQuest > 0).map((i) => ({ entry: i.entry, questId: i.startsQuest }));
    const entries = new Set(projectEntities().items.map((i) => i.entry));
    return [...starters.filter((s) => !entries.has(s.entry)), ...mine].sort((a, b) => a.entry - b.entry);
  };

  const linksFor = (live: Session, scope: readonly number[]): Promise<LinkSnapshot> =>
    loadLinks(live.db, scope, projectAggregates(), live.availability.available, withProjectStarters(live.itemStarters));

  /**
   * A quest's own validation plus what its links say about it. Only for display: the export gate
   * reads errors alone and link issues are warnings, so `guardWrite` has no use for them.
   */
  async function issuesOf(live: Session, questId: number, aggregate: QuestAggregate, refs: RefChecker): Promise<Issue[]> {
    const own = await validateQuest(aggregate, refs);
    return [
      ...own,
      ...(await scriptIssues(live, aggregate)),
      ...(await newEntityIssues(live, questEntities(aggregate))),
      ...linkIssues(questId, await linksFor(live, [questId])),
    ];
  }

  /** Opens one quest: the project's copy if it has one, otherwise a fresh import placed on the canvas. */
  async function openOne(questId: number, position?: NodePosition): Promise<OpenResult> {
    const live = usable();
    const refs = refsFor(live);
    const quest = quests.get(questId);

    // A brand-new quest (never exported) has no row in the live database to import or diff
    // against — asking the importer for it would fail outright, so the project's copy alone is opened.
    if (quest?.isNew) {
      return {
        questId,
        aggregate: quest.aggregate,
        fidelity: quest.fidelity ?? { ok: true },
        unmodelled: [],
        issues: await issuesOf(live, questId, quest.aggregate, refs),
        inProject: true,
        stale: false,
        locales: [],
        importedText: {},
      };
    }

    // The importer is the one place that decides what a usable quest ID is.
    const fresh = await importWithScenes(live, questId);
    const fidelity = roundTripOf(fresh, live.schema);
    const unmodelled = listUnmodelled(live.schema, registry, fresh.snapshot);
    // Both branches report the translations against the rows just read, never against the edit.
    const locales = localesInSnapshot(fresh.snapshot);
    const importedText = localizedTextValues(fresh.aggregate, registry);

    if (quest) {
      // The project's copy is the user's work: it is returned as it stands, wherever it sits, and only
      // the comparison against the freshly read rows says whether the world moved underneath.
      const stale = compareTables(quest.snapshot?.tables ?? {}, fresh.snapshot.tables, KEY_COLUMNS).length > 0;
      // The export gate reads `quest.fidelity`, so the report the UI is about to show has to
      // become the stored one: otherwise the button and the gate answer different questions.
      if (JSON.stringify(quest.fidelity) !== JSON.stringify(fidelity)) {
        // Not an edit: the user changed nothing, so the project is not marked unsaved.
        quests.put({ ...quest, fidelity }, { quiet: true });
      }
      return {
        questId,
        aggregate: quest.aggregate,
        fidelity,
        unmodelled,
        issues: await issuesOf(live, questId, quest.aggregate, refs),
        inProject: true,
        stale,
        locales,
        importedText,
      };
    }

    const at = placeAt(position);
    quests.put({
      questId,
      isNew: false,
      aggregate: fresh.aggregate,
      snapshot: fresh.snapshot,
      fidelity,
      x: at.x,
      y: at.y,
      lastExportPath: null,
    });
    return {
      questId,
      aggregate: fresh.aggregate,
      fidelity,
      unmodelled,
      issues: await issuesOf(live, questId, fresh.aggregate, refs),
      inProject: false,
      stale: false,
      locales,
      importedText,
    };
  }

  /** The schema exports render with: the registry's tables, plus the ones quest scripting writes. */
  /** A route as the database has it, with how many spawns walk it; refused when it is gone */
  const routeFromDatabase = async (pathId: number): Promise<{ original: RoutePoint[]; walkers: number; walkerEntries: { entry: number; name: string }[]; name?: string }> => {
    const db = connected().db;
    const original = await readRoute(db, pathId);
    if (original.length === 0) throw fail('BAD_REQUEST', `Route ${pathId} is no longer in the database.`);
    const name = await routeWalkerName(db, pathId);
    return { original, walkers: await countWalkers(db, pathId), walkerEntries: await readWalkerEntries(db, pathId), ...(name ? { name } : {}) };
  };

  const exportSchema = (live: Session): SchemaInfo => ({
    ...live.schema,
    tables: { ...live.scriptSchema.tables, ...live.schema.tables },
  });

  const missingScriptTables = (live: Session): string[] =>
    SCRIPT_TABLES.filter((t) => !live.scriptSchema.tables[t]);

  /** The scene issues of a quest, which need the owners' templates to tell whether a C++ script runs them. */
  async function scriptIssues(live: Session, aggregate: QuestAggregate): Promise<Issue[]> {
    const scenes = readScenes(aggregate.values);
    if (scenes.length === 0) return [];
    const creatures = scenes.flatMap((s) => (s.owner.kind === 'creature' && s.owner.entry > 0 ? [String(s.owner.entry)] : []));
    const objects = scenes.flatMap((s) => (s.owner.kind === 'gameobject' && s.owner.entry > 0 ? [String(s.owner.entry)] : []));
    const [creatureRows, objectRows] = await Promise.all([
      rowsOrNone(live.db, 'creature_template', { entry: creatures }),
      rowsOrNone(live.db, 'gameobject_template', { entry: objects }),
    ]);
    const cppOwners = [
      ...creatureRows.filter((r) => (r.ScriptName ?? '') !== '' && r.AIName !== 'SmartAI').map((r) => `creature:${r.entry}`),
      ...objectRows.filter((r) => (r.ScriptName ?? '') !== '' && r.AIName !== 'SmartGameObjectAI').map((r) => `gameobject:${r.entry}`),
    ];
    const flags = aggregate.values['quest_template_addon.SpecialFlags'];
    return sceneIssues({
      questId: aggregate.questId,
      scenes,
      objectives: objectivesOf(aggregate),
      givers: relationOwners(aggregate, 'starter'),
      enders: relationOwners(aggregate, 'ender'),
      cppOwners,
      missingTables: missingScriptTables(live),
      specialFlags: typeof flags === 'number' ? flags : 0,
    });
  }

  /**
   * A path id no route uses yet, for a new path of the spawn `guid`: the database's own convention of
   * the guid times ten when that is free, else one past the highest id in use. In use counts the
   * database, the project's patrols and the world layer's routes and new paths.
   */
  async function freePathId(guid: number): Promise<number> {
    const live = connected();
    const layer = deps.session.world.get();
    const used = [
      ...projectEntities().npcs.flatMap((n) => n.spawns.flatMap((s) => (s.patrol ? [s.patrol.pathId] : []))),
      ...layer.routes.map((r) => r.pathId),
      ...movementsOf(layer).flatMap((m) => (m.current.pathId === null ? [] : [m.current.pathId])),
    ];
    const candidate = guid * 10;
    const inDb = (await rowsOrNone(live.db, 'waypoint_data', { id: [String(candidate)] })).length > 0;
    if (!inDb && !used.includes(candidate)) return candidate;
    let dbMax = 0;
    try {
      dbMax = (await live.db.selectMax?.('waypoint_data', 'id')) ?? 0;
    } catch {
      dbMax = 0;
    }
    return Math.max(dbMax, ...used, 0) + 1;
  }

  /** The existing NPCs and objects a quest names, by role: givers, enders, then objectives */
  function wantedOf(aggregate: QuestAggregate): { role: QuestMapRef['role']; kind: 'creature' | 'gameobject'; entry: number }[] {
    const wanted: { role: QuestMapRef['role']; kind: 'creature' | 'gameobject'; entry: number }[] = [];
    for (const [role, relation] of [['giver', 'starter'], ['ender', 'ender']] as const) {
      for (const owner of relationOwners(aggregate, relation)) {
        if (owner.kind === 'creature' || owner.kind === 'gameobject') wanted.push({ role, kind: owner.kind, entry: owner.entry });
      }
    }
    for (const entry of objectivesOf(aggregate)) {
      if (entry > 0) wanted.push({ role: 'objective', kind: 'creature', entry });
      else if (entry < 0) wanted.push({ role: 'objective', kind: 'gameobject', entry: -entry });
    }
    return wanted;
  }

  /** Every new NPC, object and item in the project, from every quest. */
  function projectEntities(): ProjectEntities {
    return deps.session.entities.get();
  }

  /** The project's NPCs, objects and items a quest uses: made for it, or named by it */
  function questEntities(aggregate: QuestAggregate): ProjectEntities {
    const store = projectEntities();
    return narrowTo(store, questUses({ questId: aggregate.questId, aggregate }, store));
  }

  /**
   * Reference checks that also know the project's new NPCs and objects: they exist, and a new NPC
   * counts as a quest giver because export gives it the flag whenever it starts or ends a quest.
   */
  function refsFor(live: Session): RefChecker {
    const base = refCheckerFor(live.db);
    return {
      exists(kind, id) {
        const { npcs, objects, items } = projectEntities();
        if (kind === 'creature' && npcs.some((n) => n.entry === id)) return Promise.resolve(true);
        if (kind === 'gameobject' && objects.some((o) => o.entry === id)) return Promise.resolve(true);
        if (kind === 'item' && items.some((i) => i.entry === id)) return Promise.resolve(true);
        return base.exists(kind, id);
      },
      questGiver(kind, id) {
        const { npcs, objects } = projectEntities();
        if (kind === 'creature' && npcs.some((n) => n.entry === id)) return Promise.resolve(true);
        const object = kind === 'gameobject' ? objects.find((o) => o.entry === id) : undefined;
        if (object) return Promise.resolve(object.type === 'questGiver');
        return base.questGiver(kind, id);
      },
    };
  }

  /** Each project quest's NPC-or-object objectives, by quest id, for fights that give credit */
  const objectivesByQuest = (): Map<number, readonly number[]> => new Map(quests.list().map((q) => [q.questId, objectivesOf(q.aggregate)]));

  async function newEntityIssues(live: Session, entities: ProjectEntities): Promise<Issue[]> {
    if (entities.npcs.length + entities.objects.length + entities.items.length === 0) return [];
    const startedQuests = [...new Set(entities.items.map((i) => i.startsQuest).filter((q) => q > 0))];
    const [creatures, objects, itemRows, questRows] = await Promise.all([
      rowsOrNone(live.db, 'creature_template', { entry: entities.npcs.map((n) => String(n.entry)) }),
      rowsOrNone(live.db, 'gameobject_template', { entry: entities.objects.map((o) => String(o.entry)) }),
      rowsOrNone(live.db, 'item_template', { entry: entities.items.map((i) => String(i.entry)) }),
      rowsOrNone(live.db, 'quest_template', { ID: startedQuests.map(String) }),
    ]);
    const dbNames = new Map<string, string>([
      ...creatures.map((r) => [`creature:${r.entry}`, r.name ?? ''] as [string, string]),
      ...objects.map((r) => [`gameobject:${r.entry}`, r.name ?? ''] as [string, string]),
      ...itemRows.map((r) => [`item:${r.entry}`, r.name ?? ''] as [string, string]),
    ]);
    const knownQuests = new Set([...questRows.map((r) => Number(r.ID)), ...quests.usedQuestIds()]);
    const itemColumnTypes = new Map((live.scriptSchema.tables.item_template ?? []).map((c) => [c.name, c.dataType]));
    // Only a spell list already loaded: a validation run must not wait for, or start, the big read.
    const spells = live.spellsReady;
    const held = [...new Set(entities.npcs.flatMap((n) => [n.equipment.mainHand, n.equipment.offHand, n.equipment.ranged]).filter((i) => i > 0))];
    const items = held.length > 0 ? await rowsOrNone(live.db, 'item_template', { entry: held.map(String) }) : [];
    const itemInventoryTypes = new Map(items.map((r) => [Number(r.entry), Number(r.InventoryType ?? 0)]));
    return entityIssues({
      entities, dbNames, questItems: [...new Set(quests.list().flatMap((q) => questItemsOf(q.aggregate)))], objectives: objectivesByQuest(),
      knownSpell: spells ? (id) => spells.get(id) !== undefined : null, itemInventoryTypes,
      knownQuest: (id) => knownQuests.has(id), itemColumnTypes: itemColumnTypes.size > 0 ? itemColumnTypes : null,
    });
  }

  /**
   * The terrain grid under a point, cached across sessions by folder and file: null when no map
   * file covers it, a reason when the file is damaged.
   */
  async function terrainAt(dir: string, map: number, x: number, y: number): Promise<{ file: TerrainFile | null } | { reason: string }> {
    const name = gridFileName(map, x, y);
    const key = `${dir}|${name}`;
    const cached = terrainCache.get(key);
    if (cached !== undefined) return { file: cached };
    const files = deps.mapDataFiles ?? deps.serverDataFiles ?? NO_SERVER_DATA_FILES;
    let file: TerrainFile | null = null;
    // The folder may be the server's DataDir or its dbc folder; maps/ sits in the one, beside the other.
    for (const folder of [join(dir, 'maps'), join(dir, '..', 'maps')]) {
      const bytes = await files.read(folder, name);
      if (!bytes) continue;
      try {
        file = parseMapFile(bytes);
      } catch (error) {
        if (error instanceof TerrainFormatError) return { reason: `${name} could not be read: ${error.message}` };
        throw error;
      }
      break;
    }
    terrainCache.set(key, file);
    if (terrainCache.size > TERRAIN_CACHE_SIZE) terrainCache.delete(terrainCache.keys().next().value!);
    return { file };
  }

  /** The navmesh tile under a point, cached per session; null when it is missing or unreadable. */
  async function navTileAt(live: Session, dir: string, map: number, x: number, y: number): Promise<NavTile | null> {
    const name = navTileFileName(map, x, y);
    const cache = (live.navTiles ??= new Map());
    if (cache.has(name)) {
      const tile = cache.get(name)!;
      cache.delete(name);
      cache.set(name, tile);
      return tile;
    }
    const files = deps.mapDataFiles ?? deps.serverDataFiles ?? NO_SERVER_DATA_FILES;
    let tile: NavTile | null = null;
    for (const folder of [join(dir, 'mmaps'), join(dir, '..', 'mmaps')]) {
      const bytes = await files.read(folder, name);
      if (!bytes) continue;
      try {
        tile = parseNavTile(bytes);
      } catch (error) {
        console.warn(`Navmesh: ${name} could not be read: ${error instanceof Error ? error.message : String(error)}`);
      }
      break;
    }
    cache.set(name, tile);
    if (cache.size > NAV_CACHE_SIZE) cache.delete(cache.keys().next().value!);
    return tile;
  }

  /**
   * The maps the quest map shows: the open-world maps of `Map.dbc` that have terrain in the data
   * folder, continents first, with zone names. Without the folder (or its files), the continents.
   */
  function mapsOf(live: Session): Promise<MapInfo[]> {
    live.mapInfo ??= (async () => {
      const dir = live.serverData?.status.dir;
      if (!dir) return [...CONTINENTS];
      const files = deps.serverDataFiles ?? NO_SERVER_DATA_FILES;
      try {
        const [maps, areas, zones] = await Promise.all([
          readServerDataFile(dir, MAP_FILE, files),
          readServerDataFile(dir, AREA_TABLE_FILE, files),
          readServerDataFile(dir, WORLD_MAP_AREA_FILE, files),
        ]);
        if (!maps) return [...CONTINENTS];
        const names = parseMapNames(maps);
        const labels = areas && zones ? parseZoneLabels(zones, areas) : [];
        const gridFiles = [...((await files.list?.(join(dir, 'maps'))) ?? []), ...((await files.list?.(join(dir, '..', 'maps'))) ?? [])];
        const withTerrain = new Set(gridFiles.filter((f) => f.toLowerCase().endsWith('.map')).map((f) => Number(f.slice(0, 3))));
        const continents = CONTINENTS.map((c) => c.id);
        const rank = (id: number): number => (continents.includes(id) ? continents.indexOf(id) : continents.length);
        const ids = [...names.entries()]
          .filter(([id, m]) => !m.instance && (withTerrain.has(id) || (withTerrain.size === 0 && continents.includes(id))))
          .map(([id]) => id)
          .sort((a, b) => rank(a) - rank(b) || a - b);
        return ids.map((id) => ({
          id,
          name: names.get(id)!.name,
          zones: labels.filter((l) => l.map === id).map(({ name, x, y }) => ({ name, x, y })),
        }));
      } catch (error) {
        console.warn(`Map list: ${error instanceof Error ? error.message : String(error)}`);
        return [...CONTINENTS];
      }
    })();
    return live.mapInfo;
  }

  /**
   * The server's spell list for this session, read on first use rather than at connect: the file
   * is large and only fights need it. A missing folder or file becomes a reason, never a failure.
   */
  function spellsOf(live: Session): Promise<SpellIndex | { reason: string }> {
    live.spells ??= (async () => {
      const dir = live.serverData?.status.dir;
      if (!dir) return { reason: 'Spell names need the server data folder.' };
      const files = deps.serverDataFiles ?? NO_SERVER_DATA_FILES;
      try {
        const spell = await readServerDataFile(dir, SPELL_FILE, files);
        if (!spell) return { reason: `${SPELL_FILE} is not in ${dir} or its dbc folder.` };
        const [castTimes, ranges, overrides] = await Promise.all([
          readServerDataFile(dir, CAST_TIMES_FILE, files),
          readServerDataFile(dir, RANGE_FILE, files),
          rowsOrNone(live.db, 'spell_dbc', {}),
        ]);
        const index = readSpellIndex({ spell, castTimes, ranges, overrides });
        live.spellsReady = index;
        return index;
      } catch (error) {
        return { reason: `${SPELL_FILE} could not be read: ${error instanceof Error ? error.message : String(error)}` };
      }
    })();
    return live.spells;
  }

  /** The server's sound names for this session, read on first use like the spell list. */
  function soundsOf(live: Session): Promise<SoundIndex | { reason: string }> {
    live.sounds ??= (async () => {
      const dir = live.serverData?.status.dir;
      if (!dir) return { reason: 'Sound names need the server data folder.' };
      try {
        const bytes = await readServerDataFile(dir, SOUND_FILE, deps.serverDataFiles ?? NO_SERVER_DATA_FILES);
        return bytes ? readSoundIndex(bytes) : { reason: `${SOUND_FILE} is not in ${dir} or its dbc folder.` };
      } catch (error) {
        return { reason: `${SOUND_FILE} could not be read: ${error instanceof Error ? error.message : String(error)}` };
      }
    })();
    return live.sounds;
  }

  /**
   * Quest log headings: zones from the server data folder, when it has them, and categories (from
   * `QuestSort.dbc`, or the stock list). A missing or unreadable file only loses its names.
   */
  function questSortsOf(live: Session): Promise<QuestSortIndex> {
    live.questSorts ??= (async () => {
      const dir = live.serverData?.status.dir;
      const files = deps.serverDataFiles ?? NO_SERVER_DATA_FILES;
      const read = async (name: string): Promise<Uint8Array | undefined> => {
        if (!dir) return undefined;
        try {
          return (await readServerDataFile(dir, name, files)) ?? undefined;
        } catch {
          return undefined;
        }
      };
      const [areas, maps, sorts] = await Promise.all([read(AREA_TABLE_FILE), read(MAP_FILE), read(QUEST_SORT_FILE)]);
      try {
        return readQuestSorts({ areas, maps, sorts });
      } catch {
        return readQuestSorts({});
      }
    })();
    return live.questSorts;
  }

  /** One of the look or faction indexes, read from the server data folder on first use. */
  function lookOf(live: Session, kind: LookKind): Promise<DisplayIndex | FactionTemplateIndex | { reason: string }> {
    const looks = (live.looks ??= {});
    looks[kind] ??= (async () => {
      const dir = live.serverData?.status.dir;
      if (!dir) return { reason: 'Looks and factions need the server data folder.' };
      const files = deps.serverDataFiles ?? NO_SERVER_DATA_FILES;
      const read = async (name: string): Promise<Uint8Array> => {
        const bytes = await readServerDataFile(dir, name, files);
        if (!bytes) throw new Error(`${name} is not in ${dir} or its dbc folder.`);
        return bytes;
      };
      try {
        if (kind === 'objectDisplay') return readObjectDisplays(await read(DISPLAY_FILES.objectDisplays));
        if (kind === 'factionTemplate') {
          const [templates, factions] = await Promise.all([read(FACTION_TEMPLATE_FILES.templates), read(FACTION_TEMPLATE_FILES.factions)]);
          return readFactionTemplates({ templates, factions });
        }
        const [displays, models, extras, races] = await Promise.all([
          read(DISPLAY_FILES.creatureDisplays), read(DISPLAY_FILES.creatureModels), read(DISPLAY_FILES.displayExtras), read(DISPLAY_FILES.races),
        ]);
        return readCreatureDisplays({ displays, models, extras, races });
      } catch (error) {
        return { reason: error instanceof Error ? error.message : String(error) };
      }
    })();
    return looks[kind]!;
  }

  const LOOK_KINDS: ReadonlySet<string> = new Set<LookKind>(['creatureDisplay', 'objectDisplay', 'factionTemplate']);
  const isLookKind = (kind: string): kind is LookKind => LOOK_KINDS.has(kind);
  /** How many names a look's "used by" lists. */
  const USED_BY_NAMES = 3;

  /** A look's hits, each with up to three NPCs or objects in the world that use it. */
  async function lookHits(live: Session, kind: LookKind, text: string): Promise<EntityHit[]> {
    const index = await lookOf(live, kind);
    if ('reason' in index) return [];
    if (kind === 'factionTemplate') return (index as FactionTemplateIndex).search(text, ENTITY_SEARCH_LIMIT);
    const hits = (index as DisplayIndex).search(text, ENTITY_SEARCH_LIMIT);
    if (hits.length === 0) return [];
    const ids = hits.map((h) => String(h.id));
    const users = new Map<number, string[]>();
    const note = (display: number, name: string): void => {
      const names = users.get(display) ?? [];
      if (names.length < USED_BY_NAMES && name) names.push(name);
      users.set(display, names);
    };
    if (kind === 'creatureDisplay') {
      const models = await rowsOrNone(live.db, 'creature_template_model', { CreatureDisplayID: ids });
      const entries = [...new Set(models.map((m) => Number(m.CreatureID)))].sort((a, b) => a - b);
      const names = await live.db.lookupNames('creature', entries);
      for (const entry of entries) {
        for (const m of models) if (Number(m.CreatureID) === entry) note(Number(m.CreatureDisplayID), names.get(entry) ?? '');
      }
    } else {
      const objects = await rowsOrNone(live.db, 'gameobject_template', { displayId: ids });
      for (const o of [...objects].sort((a, b) => Number(a.entry) - Number(b.entry))) note(Number(o.displayId), o.name ?? '');
    }
    return hits.map((h) => {
      const names = users.get(h.id) ?? [];
      return names.length > 0 ? { ...h, detail: `used by ${names.join(', ')}` } : h;
    });
  }

  /**
   * Every SmartAI row of the quest compiled against the world DB right now: its scenes, then the
   * fights of its new NPCs around them. Every project NPC goes to the fight compiler, so the rows of
   * a fight since removed are deleted.
   */
  async function compileFor(live: Session, aggregate: QuestAggregate): Promise<{ context: ScriptContext; compiled: CompiledScripts }> {
    const scenes = readScenes(aggregate.values);
    const context = await readScriptContext(live.db, aggregate.questId, scenes);
    // The project patch's fight and patrol rows go in first (Apply to dev runs it first): scenes keep off them
    const project = await projectScripts(live);
    const compiled = compileScenes({ questId: aggregate.questId, scenes, objectives: objectivesOf(aggregate), context, taken: project.compiled });
    return { context, compiled };
  }

  /**
   * The SmartAI rows of the project's NPCs: their fights, then what they do at patrol points. Every
   * project NPC goes in, so the rows of a fight or point action since removed are deleted.
   */
  async function projectScripts(live: Session): Promise<{ context: ScriptContext; compiled: CompiledScripts }> {
    const { npcs } = projectEntities();
    const context = await readScriptContext(live.db, 0, [], npcs.map((n) => n.entry));
    const none: CompiledScripts = { inserts: {}, deletes: {}, updates: [], flags: [], warnings: [] };
    const fights = compileFights({ npcs, objectives: objectivesByQuest(), context, taken: none });
    const patrols = compilePatrols({ npcs, context, taken: fights });
    return { context, compiled: mergeCompiled(fights, patrols) };
  }

  /**
   * The project patch: every new NPC, object and item and their SmartAI rows, then the world layer's
   * edits, with a revert that deletes what the first part writes and puts the world back.
   */
  async function projectPatch(live: Session): Promise<{ apply: PatchStatement[]; revert: PatchStatement[]; schema: SchemaInfo; warnings: string[] }> {
    const store = projectEntities();
    const layer: WorldLayer = deps.session.world.get();
    const all = quests.list();
    const ws = await worldSchema(live.db, live.schema.hash);
    const base = exportSchema(live);
    const schema: SchemaInfo = { ...base, tables: { ...ws.tables, ...base.tables } };
    const givers = all.flatMap((q) => [...relationOwners(q.aggregate, 'starter'), ...relationOwners(q.aggregate, 'ender')]).flatMap((o) => (o.kind === 'creature' ? [o.entry] : []));
    const questItems = all.flatMap((q) => questItemsOf(q.aggregate).map((item) => ({ item, questId: q.questId })));
    const entityContext = await readEntityContext(live.db, store, all.map((q) => q.questId));
    const compiledEntities = compileEntities({
      entities: store, givers, questItems, context: entityContext,
      itemColumns: live.scriptSchema.tables.item_template ? new Set(live.scriptSchema.tables.item_template.map((c) => c.name)) : null,
    });
    const scripts = await projectScripts(live);
    const entityStatements = scriptStatements(compiledEntities, schema).statements;
    const scriptRows = scriptStatements(scripts.compiled, schema).statements;
    let world: { apply: PatchStatement[]; revert: PatchStatement[] } = { apply: [], revert: [] };
    if (hasWorldChanges(layer)) {
      // The rows of placed spawns are made of the database's own columns, so a fork's extra ones are filled
      const spawnDefaults: SpawnDefaults = {};
      for (const kind of ['creature', 'gameobject'] as const) {
        if (layer.added.some((a) => a.kind === kind)) spawnDefaults[kind] = defaultColumnValues(kind, ws);
      }
      // A spawn given a path without an addon row of its own gets one, made of the table's own columns
      const writesAddon = movementsOf(layer).some((m) => !m.addonRow && m.current.pathId !== m.original.pathId);
      const addonDefaults = writesAddon ? defaultColumnValues('creature_addon', ws) : undefined;
      world = worldStatements(layer, defaultColumnValues('waypoint_data', ws), spawnDefaults, addonDefaults);
    }
    const of = (list: readonly PatchStatement[], kind: PatchStatement['kind']) => list.filter((st) => st.kind === kind);
    // Deletes first; the entities before the SmartAI rows that act on them; the world's edits last
    const apply = [
      ...of(entityStatements, 'delete'), ...of(scriptRows, 'delete'),
      ...of(entityStatements, 'insert'),
      ...of(scriptRows, 'set-flag'), ...of(entityStatements, 'update'), ...of(scriptRows, 'update'), ...of(scriptRows, 'insert'),
      ...world.apply,
    ];
    // The revert takes away every row the entities part wrote, the last written first
    const keysOf = (table: string): readonly string[] => ENTITY_KEYS[table] ?? SCRIPT_KEYS[table] ?? [];
    const written = [...of(entityStatements, 'insert'), ...of(scriptRows, 'insert')].reverse();
    const revert: PatchStatement[] = [];
    const seen = new Set<string>();
    for (const st of written) {
      if (st.kind !== 'insert') continue;
      const key = Object.fromEntries(keysOf(st.table).map((c) => [c, String(st.row[c] ?? '')]));
      const text = `${st.table}:${JSON.stringify(key)}`;
      if (Object.keys(key).length === 0 || seen.has(text)) continue;
      seen.add(text);
      revert.push({ kind: 'delete', table: st.table, key });
    }
    revert.push(...world.revert);
    return { apply, revert, schema, warnings: [...compiledEntities.warnings, ...scripts.compiled.warnings] };
  }

  /** The project's NPCs, objects and items checked; throws when they have errors */
  async function guardProject(live: Session): Promise<void> {
    const issues = await newEntityIssues(live, projectEntities());
    if (issues.some((i) => i.severity === 'error')) {
      throw fail('VALIDATION', "Fix the errors on the project's NPCs, objects and items first.", { issues });
    }
  }

  /**
   * A fresh import with the scenes the tool exported for this quest before, rebuilt from their rows,
   * so a quest opened in a new project keeps its scripting editable.
   */
  async function importWithScenes(live: Session, questId: number): Promise<{ aggregate: QuestAggregate; snapshot: Snapshot }> {
    const fresh = await importQuest(live.db, live.schema, registry, questId);
    const tagged = await taggedRows(live.db, 'smart_scripts', 'comment', questId);
    const { scenes } = scenesFromRows(questId, tagged);
    return { ...fresh, aggregate: { ...fresh.aggregate, values: { ...fresh.aggregate.values, [SCRIPTS_FIELD]: writeScenes(scenes) } } };
  }

  /** The three gates every write passes: lossless import, no validation errors, and a free ID. */
  async function guardWrite(live: Session, quest: ProjectQuest): Promise<Issue[]> {
    const db = live.db;
    if (quest.fidelity !== null && !quest.fidelity.ok) {
      throw fail(
        'FIDELITY',
        `Quest ${quest.questId} did not survive the round-trip check, so exporting it could change data the editor never showed.`,
        { differences: quest.fidelity.differences },
      );
    }
    const issues = [
      ...(await validateQuest(quest.aggregate, refsFor(live))),
      ...(await scriptIssues(live, quest.aggregate)),
    ];
    if (issues.some((i) => i.severity === 'error')) {
      throw fail('VALIDATION', 'Fix the errors on this quest before exporting it.', { issues });
    }
    if (quest.isNew) await assertIdFree(db, quest.questId);
    return issues;
  }

  async function patchFor(
    live: Session,
    quest: ProjectQuest,
  ): Promise<{ statements: PatchStatement[]; warnings: PatchWarning[]; fixes: QuestGiverFix[]; scriptContext: ScriptContext; entityStatements: PatchStatement[] }> {
    const fixes = await findQuestGiverFixes(live.db, quest.aggregate.values);
    // Read the neighbouring linked rows now rather than trusting the ones the import saw: the
    // edit may name a creature the quest had nothing to do with when it was opened, and those
    // are exactly the rows a new drop source would otherwise be allocated on top of.
    const linkedContext = await fetchLinkedContext({
      db: live.db,
      registry,
      schema: live.schema,
      tables: quest.snapshot?.tables ?? {},
      values: quest.aggregate.values,
    });
    const { statements, warnings } = buildPatch({
      aggregate: quest.aggregate,
      snapshot: quest.snapshot,
      schema: live.schema,
      registry,
      questGiverFixes: fixes.map((f) => f.entry),
      linkedContext,
    });
    const { context: scriptContext, compiled } = await compileFor(live, quest.aggregate);
    const scripts = scriptStatements(compiled, exportSchema(live));
    // The project's new NPCs, objects and items are the project patch's; a quest patch writes none
    const newEntities = { statements: [] as PatchStatement[] };
    const of = (list: readonly PatchStatement[], kind: PatchStatement['kind']) => list.filter((s) => s.kind === kind);
    // Deletes before anything is written; the flags and updates quest scripting puts on NPCs, then
    // the quest's and the scenes' rows.
    const merged = [
      ...of(statements, 'delete'), ...of(scripts.statements, 'delete'),
      ...of(statements, 'set-flag'), ...of(scripts.statements, 'set-flag'),
      ...of(statements, 'update'), ...of(scripts.statements, 'update'),
      ...of(statements, 'insert'), ...of(scripts.statements, 'insert'),
    ];
    const scriptWarnings: PatchWarning[] = compiled.warnings.map((message) => ({ code: 'SCRIPT_WARNING', table: 'smart_scripts', message }));
    return { statements: merged, warnings: [...warnings, ...scriptWarnings], fixes, scriptContext, entityStatements: newEntities.statements };
  }

  return {
    testConnection: (input) =>
      run(async () => {
        const db = await deps.openWorldDb(input);
        await db.close();
        return { ok: true } as const;
      }),

    saveProfile: (input) => run(async () => deps.store.profiles.save(input)),

    listProfiles: () => run(async () => deps.store.profiles.list()),

    deleteProfile: (id) =>
      run(async () => {
        if (session?.profileId === id) throw fail('VALIDATION', 'This connection is in use. Connect with another before removing it.');
        deps.store.profiles.remove(id);
        return null;
      }),

    startupProfile: () => run(async () => deps.startupProfileId ?? null),

    connect: (profileId) =>
      run(async () => {
        const profile = deps.store.profiles.getWithPassword(profileId);
        const db = await deps.openWorldDb(profile);
        const dataDir = profile.dbcDir?.trim() || null;
        const clientDir = profile.clientDir?.trim() || null;
        const before = folders;
        // Until the connect is confirmed, the old connection (and the map's folders with it) stays live.
        let reads;
        try {
          const schema = await loadSchema(db, REGISTRY_TABLES);
          const contextSchema = await loadSchema(db, CONTEXT_TABLES);
          // Where the context list and the registry share a table, the registry's reading is the one
          // the rest of the session already trusts, so it wins.
          const availability = componentAvailability({ ...contextSchema.tables, ...schema.tables });
          // Only asked of a table the schema read says this user can see, so a missing grant on
          // item_template leaves item starts empty instead of failing the whole connection.
          const itemStarters = contextSchema.tables.item_template?.some((c) => c.name === 'startquest')
            ? await readItemStarters(db)
            : [];
          const serverData = await loadServerData(profile.dbcDir ?? '', deps.serverDataFiles ?? NO_SERVER_DATA_FILES);
          const scriptSchema = await loadSchema(db, [...new Set<string>([...SCRIPT_TABLES, ...ENTITY_TABLES])]);
          setFolders({ dataDir, clientDir });
          const client = clientDir ? ((await deps.clientStatus?.()) ?? null) : null;
          reads = { schema, contextSchema, availability, itemStarters, serverData, scriptSchema, client };
        } catch (e) {
          if (folders !== before) setFolders(before);
          if (session?.db !== db) await db.close().catch(() => undefined);
          throw e;
        }
        const { schema, contextSchema, availability, itemStarters, serverData, scriptSchema, client } = reads;
        const drift = diffSchema(schema, registry);
        const blocking = hasBlockingDrift(drift);
        // Swapping connections must not leave the old one open.
        if (session && session.db !== db) await session.db.close();
        session = {
          profileId,
          exportDir: profile.exportDir?.trim() || null,
          db,
          schema,
          blocking,
          blockingTables: drift.blockingTables,
          forbiddenTables: drift.forbiddenTables,
          contextTables: contextSchema.tables,
          availability,
          itemStarters,
          serverData,
          scriptSchema,
        };
        deps.store.profiles.markConnected(profileId, deps.now());
        return { profileId, schemaHash: schema.hash, drift, blocking, serverData: serverData?.status ?? null, clientDir, client };
      }),

    chooseServerDataDir: () => run(async () => (deps.chooseDirectory ? await deps.chooseDirectory() : null)),

    searchQuests: (text) => run(async () => connected().db.searchQuests(text, SEARCH_LIMIT)),
    searchEntities: (kind, text) =>
      run(async () => {
        if (kind === 'sound') {
          const sounds = await soundsOf(connected());
          return 'reason' in sounds ? [] : sounds.search(text, ENTITY_SEARCH_LIMIT);
        }
        if (isLookKind(kind)) return lookHits(connected(), kind, text);
        if (kind === 'questSort') return (await questSortsOf(connected())).search(text, ENTITY_SEARCH_LIMIT);
        if (kind === 'spell') {
          const spells = await spellsOf(connected());
          if ('reason' in spells) return [];
          return spells.search(text, ENTITY_SEARCH_LIMIT).map((f) => ({ id: f.id, name: spellLabel(f), detail: spellDetail(f) }));
        }
        const found = await connected().db.searchEntities(kind, text, ENTITY_SEARCH_LIMIT);
        if (kind !== 'creature' && kind !== 'gameobject' && kind !== 'item') return found;
        const { npcs, objects, items } = projectEntities();
        const needle = text.trim().toLowerCase();
        if (needle === '') return found;
        const word = { creature: 'NPC', gameobject: 'object', item: 'item' }[kind];
        const mine = (kind === 'creature' ? npcs : kind === 'gameobject' ? objects : items)
          .filter((e) => e.name.toLowerCase().includes(needle) || String(e.entry) === needle)
          .map((e) => ({ id: e.entry, name: e.name || `New ${word} ${e.entry}`, detail: 'new' }));
        const ids = new Set(mine.map((h) => h.id));
        return [...mine, ...found.filter((h) => !ids.has(h.id))].slice(0, ENTITY_SEARCH_LIMIT);
      }),

    allocateIds: (kind, count) =>
      run(async () => {
        // Spawns placed in the 3D view are not in the database yet, but their ids are taken
        const placedGuids = (spawnKind: 'creature' | 'gameobject'): number[] => deps.session.world.get().added.filter((a) => a.kind === spawnKind).map((a) => a.guid);
        const live = connected();
        const [table, column] = {
          creature: ['creature_template', 'entry'],
          gameobject: ['gameobject_template', 'entry'],
          creatureSpawn: ['creature', 'guid'],
          gameobjectSpawn: ['gameobject', 'guid'],
          page: ['page_text', 'ID'],
          item: ['item_template', 'entry'],
        }[kind] as [string, string];
        let dbMax = 0;
        try {
          dbMax = (await live.db.selectMax?.(table, column)) ?? 0;
        } catch {
          dbMax = 0;
        }
        const { npcs, objects, items } = projectEntities();
        const used =
          kind === 'creature' ? npcs.map((n) => n.entry)
          : kind === 'gameobject' ? objects.map((o) => o.entry)
          : kind === 'item' ? items.map((i) => i.entry)
          : kind === 'creatureSpawn' ? [...npcs.flatMap((n) => n.spawns.map((s) => s.guid)), ...placedGuids('creature')]
          : kind === 'page' ? [...objects, ...items].flatMap((o) => o.pages.map((p) => p.id))
          : [...objects.flatMap((o) => o.spawns.map((s) => s.guid)), ...placedGuids('gameobject')];
        const base = Math.max(dbMax, ...used, 0);
        return Array.from({ length: count }, (_, i) => base + i + 1);
      }),

    patrolPathId: (guid) =>
      run(async () => {
        const pinned = projectEntities().npcs.flatMap((n) => n.spawns).find((s) => s.guid === guid)?.patrol;
        if (pinned) return pinned.pathId;
        return freePathId(guid);
      }),

    worldNewPathId: (guid) => run(async () => freePathId(guid)),

    entityTemplate: (kind, entry) =>
      run(async () => {
        const live = connected();
        const numberOf = (raw: string | null | undefined, fallback = 0): number => {
          const n = Number(raw);
          return raw === null || raw === undefined || !Number.isFinite(n) ? fallback : n;
        };
        const nameOf = <T extends Record<string, number>>(map: T, value: number, fallback: keyof T): keyof T =>
          (Object.keys(map) as (keyof T)[]).find((k) => map[k] === value) ?? fallback;
        if (kind === 'creature') {
          const [row] = await rowsOrNone(live.db, 'creature_template', { entry: [String(entry)] });
          if (!row) return null;
          const [model] = await rowsOrNone(live.db, 'creature_template_model', { CreatureID: [String(entry)], Idx: ['0'] });
          const [gear] = await rowsOrNone(live.db, 'creature_equip_template', { CreatureID: [String(entry)], ID: ['1'] });
          return {
            name: row.name ?? '', subname: row.subname ?? '',
            minLevel: numberOf(row.minlevel, 1), maxLevel: numberOf(row.maxlevel, 1), faction: numberOf(row.faction, 35),
            rank: nameOf(RANK_VALUE, numberOf(row.rank), 'normal'), type: nameOf(NPC_TYPE_VALUE, numberOf(row.type), 'none'),
            healthModifier: numberOf(row.HealthModifier, 1), damageModifier: numberOf(row.DamageModifier, 1),
            displayId: numberOf(model?.CreatureDisplayID), scale: numberOf(model?.DisplayScale, 1),
            equipment: { mainHand: numberOf(gear?.ItemID1), offHand: numberOf(gear?.ItemID2), ranged: numberOf(gear?.ItemID3) },
          };
        }
        if (kind === 'item') {
          const [item] = await rowsOrNone(live.db, 'item_template', { entry: [String(entry)] });
          if (!item) return null;
          return {
            name: item.name ?? '', displayId: numberOf(item.displayid), itemClass: numberOf(item.class), subclass: numberOf(item.subclass),
            inventoryType: numberOf(item.InventoryType),
          };
        }
        const [row] = await rowsOrNone(live.db, 'gameobject_template', { entry: [String(entry)] });
        if (!row) return null;
        return {
          name: row.name ?? '', type: nameOf(OBJECT_TYPE_VALUE, numberOf(row.type), 'generic'),
          displayId: numberOf(row.displayId), size: numberOf(row.size, 1),
        };
      }),

    itemColumns: () => run(async () => exportSchema(connected()).tables.item_template ?? []),

    openQuest: (questId, position) => run(async () => openOne(questId, position)),

    addQuestChain: (questId, position) =>
      // The picked quest and every quest chained to it are one step
      run(() => asOneStep(async () => {
        const live = usable();
        const chain = await findQuestChain(live.db, questId, MAX_CHAIN_QUESTS, undefined, withProjectStarters(live.itemStarters));
        const slots = layoutChain(chain.questIds, chain.links);
        const rootSlot = slots.get(questId) ?? { column: 0, row: 0 };

        // The picked quest lands where it was asked for; with no position, the chain starts in
        // the first column below everything already on the canvas, so it never lands on top of it.
        const onCanvas = quests.list();
        const origin = position
          ? { x: position.x - rootSlot.column * NODE_GRID.x, y: position.y - rootSlot.row * NODE_GRID.y }
          : { x: 0, y: onCanvas.length === 0 ? 0 : Math.max(...onCanvas.map((q) => q.y)) + NODE_GRID.y };
        const at = (id: number): NodePosition => {
          const slot = slots.get(id) ?? rootSlot;
          return { x: origin.x + slot.column * NODE_GRID.x, y: origin.y + slot.row * NODE_GRID.y };
        };

        // The picked quest first: if it cannot be opened, nothing else is added either.
        const open = await openOne(questId, at(questId));
        for (const id of chain.questIds) {
          if (id === questId || quests.get(id)) continue;
          const fresh = await importWithScenes(live, id);
          const place = at(id);
          quests.put({
            questId: id,
            isNew: false,
            aggregate: fresh.aggregate,
            snapshot: fresh.snapshot,
            fidelity: roundTripOf(fresh, live.schema),
            x: place.x,
            y: place.y,
            lastExportPath: null,
          });
        }
        return { open, questIds: chain.questIds, truncated: chain.truncated };
      })),

    newQuest: (position) =>
      run(async () => {
        const live = usable();
        const meta = deps.session.meta();
        const range = { start: meta.idRangeStart, end: meta.idRangeEnd };
        const taken = await collectTakenIds(live.db, range, quests.usedQuestIds());
        const questId = allocateQuestId(range, taken);
        const created = createNewAggregate(live.schema, registry, questId);
        const aggregate = {
          ...created,
          values: { ...created.values, [SCRIPTS_FIELD]: writeScenes([]) },
        };
        const fidelity: FidelityReport = { ok: true };

        const at = placeAt(position);
        // Adding it to the project straight away is what reserves the ID against the next allocation.
        quests.put({
          questId,
          isNew: true,
          aggregate,
          snapshot: null,
          fidelity,
          x: at.x,
          y: at.y,
          lastExportPath: null,
        });
        return {
          questId,
          aggregate,
          fidelity,
          unmodelled: [],
          issues: await issuesOf(live, questId, aggregate, refsFor(live)),
          inProject: false,
          stale: false,
          // A quest that does not exist yet has no translations to leave behind.
          locales: [],
          importedText: {},
        };
      }),

    listNodes: () =>
      run(async () => {
        const live = connected();
        // One checker for the whole canvas: the same NPC or item is asked about once, not per node.
        const refs = refsFor(live);
        const projectQuests = quests.list();
        const store = projectEntities();
        const canvasIds = projectQuests.map((d) => d.questId);
        const onCanvas = new Set(canvasIds);
        // One link snapshot for the whole canvas, so the context is read once rather than per node.
        const snapshot = await loadLinks(
          live.db,
          canvasIds,
          new Map(projectQuests.map((d) => [d.questId, d.aggregate])),
          live.availability.available,
          withProjectStarters(live.itemStarters),
        );
        const disconnected = disconnectedQuests(canvasIds, snapshot);
        const edges = snapshot.result.instances.flatMap((instance) =>
          questEdges(instance).map((edge) => ({ ...edge, instance })),
        );

        // A link to a quest that is not drawn is only worth counting when that quest is real, and
        // the existence check is one batched read rather than one per neighbour.
        const offCanvas = new Set<number>();
        for (const { from, to } of edges) {
          if (onCanvas.has(from) && !onCanvas.has(to)) offCanvas.add(to);
          if (onCanvas.has(to) && !onCanvas.has(from)) offCanvas.add(from);
        }
        const existing = offCanvas.size > 0 ? await live.db.existingIds('quest', [...offCanvas]) : new Set<number>();

        const nodes: CanvasNode[] = [];
        for (const quest of projectQuests) {
          const questId = quest.questId;
          const issues = [...(await validateQuest(quest.aggregate, refs)), ...linkIssues(questId, snapshot)];
          const notConnected = disconnected.has(questId);

          const links = new Map<string, NodeLink>();
          const neighbours = new Set<number>();
          for (const { from, to, instance } of edges) {
            if (from === questId) {
              links.set(`${to}/${instance.component}`, { to, component: instance.component, owner: instance.owner });
              if (!onCanvas.has(to)) neighbours.add(to);
            }
            if (to === questId && !onCanvas.has(from)) neighbours.add(from);
          }

          const startedBy = new Set<ComponentId>();
          const groups: NodeGroup[] = [];
          for (const instance of snapshot.result.instances) {
            if (
              instance.to.kind === 'quest'
              && instance.to.questId === questId
              && componentById(instance.component).hook === 'start'
            ) {
              startedBy.add(instance.component);
            }
            const kind = GROUP_KINDS[instance.component];
            const members = instance.params.members;
            if (kind && Array.isArray(members) && members.includes(questId)) {
              groups.push({ group: instance.params.group as number, kind });
            }
          }

          nodes.push({
            questId,
            title: textOf(quest.aggregate, TITLE_FIELD),
            level: numberOf(quest.aggregate, LEVEL_FIELD),
            isNew: quest.isNew,
            exported: quest.lastExportPath !== null,
            unsafe: quest.fidelity !== null && !quest.fidelity.ok,
            errors: issues.filter((i) => i.severity === 'error').length,
            warnings: issues.filter((i) => i.severity === 'warning').length + (notConnected ? 1 : 0),
            x: quest.x,
            y: quest.y,
            links: [...links.values()].sort((a, b) => a.to - b.to || a.component.localeCompare(b.component, 'en')),
            starts: START_BADGES.filter(([component]) => startedBy.has(component)).map(([, badge]) => badge),
            groups,
            offCanvasLinks: [...neighbours].filter((id) => existing.has(id)).length,
            notConnected,
            uses: questUses(quest, store),
          });
        }
        return nodes;
      }),

    moveNodes: (moves) =>
      run(async () => {
        connected();
        quests.setPositions(moves);
        return true as const;
      }),

    removeNode: (questId) =>
      run(async () => {
        connected();
        // Removing a node the user already removed is not an error; the canvas ends up the same.
        quests.remove(questId);
        return true as const;
      }),

    saveViewport: (viewport) =>
      run(async () => {
        connected();
        deps.session.setViewport(viewport);
        return true as const;
      }),

    lookupNames: (kind: RefKind, ids) =>
      run(async () => {
        if (isLookKind(kind)) {
          const index = await lookOf(connected(), kind);
          const names: Record<number, string> = {};
          if ('reason' in index) return names;
          for (const id of ids) {
            const found = index.get(id);
            if (found !== undefined) names[id] = typeof found === 'string' ? found : found.name;
          }
          return names;
        }
        if (kind === 'questSort') {
          const index = await questSortsOf(connected());
          const names: Record<number, string> = {};
          for (const id of ids) {
            const name = index.get(id);
            if (name !== undefined) names[id] = name;
          }
          return names;
        }
        if (kind === 'sound') {
          const sounds = await soundsOf(connected());
          const names: Record<number, string> = {};
          if ('reason' in sounds) return names;
          for (const id of ids) {
            const name = sounds.get(id);
            if (name !== undefined) names[id] = name;
          }
          return names;
        }
        if (kind === 'spell') {
          const spells = await spellsOf(connected());
          const names: Record<number, string> = {};
          if ('reason' in spells) return names;
          for (const id of ids) {
            const spell = spells.get(id);
            if (spell) names[id] = spellLabel(spell);
          }
          return names;
        }
        const found = await connected().db.lookupNames(kind, ids);
        // New NPCs, objects and items are not in the database until the quest is applied.
        const { npcs, objects, items } = projectEntities();
        const mine = kind === 'creature' ? npcs : kind === 'gameobject' ? objects : kind === 'item' ? items : [];
        for (const entity of mine) if (ids.includes(entity.entry) && !found.has(entity.entry)) found.set(entity.entry, entity.name || `#${entity.entry}`);
        const names: Record<number, string> = {};
        for (const [id, name] of found) names[id] = name;
        return names;
      }),

    questLinks: (questIds) =>
      run(async (): Promise<QuestLinks> => {
        const live = connected();
        const { instances, unrecognised } = (await linksFor(live, questIds)).result;

        // Every name a description could ask for, looked up in one read per kind.
        const wanted = new Map<NameKind, Set<number>>();
        const want = (kind: NameKind, id: number): void => {
          const ids = wanted.get(kind) ?? new Set<number>();
          ids.add(id);
          wanted.set(kind, ids);
        };
        for (const instance of instances) {
          for (const endpoint of [instance.from, instance.to]) {
            const target = nameTarget(endpoint);
            if (target) want(...target);
          }
          const { members, then } = instance.params;
          if (Array.isArray(members)) for (const id of members) want('quest', id);
          if (typeof then === 'number' && then > 0) want('quest', then);
        }
        for (const { row } of unrecognised) {
          const target = nameTarget(sourceEndpoint(row));
          if (target) want(...target);
        }
        const found = new Map<NameKind, Map<number, string>>();
        for (const [kind, ids] of wanted) found.set(kind, await live.db.lookupNames(kind, [...ids]));
        const names: NameBook = (kind, id) => found.get(kind)?.get(id);

        return {
          instances: instances.map((instance) => {
            const component = componentById(instance.component);
            return { ...instance, label: component.label, summary: component.describe(instance, names) };
          }),
          unrecognised: unrecognised.map(({ questId, ref, row }) => ({
            questId,
            key: ref.key,
            summary: `${describeEvent(row)}: ${actionName(row.actionType)} (${endpointName(sourceEndpoint(row), names)}, row ${row.id})`,
          })),
          unavailable: live.availability.unavailable,
        };
      }),

    // `xp[i]` is `questxp_dbc.Difficulty_{i+1}` and `money[i]` is `quest_money_reward.Money{i}`,
    // both for the row keyed by `level`; a missing row/table/column or an out-of-range level is
    // all-null rather than an error, since a fork can lack these reference tables entirely.
    // `questxp_dbc` only overrides QuestXP.dbc and is usually empty, so without a row the XP comes
    // from the server data folder's QuestXP.dbc when the profile names one.
    rewardTables: (level) =>
      run(async () => {
        const live = connected();
        const nulls = { xp: Array(REWARD_TIERS).fill(null), money: Array(REWARD_TIERS).fill(null) };
        if (!Number.isInteger(level) || level < REWARD_LEVEL_MIN || level > REWARD_LEVEL_MAX) return nulls;

        const xpRow = await readRewardRow(live.db, 'questxp_dbc', 'ID', level);
        const moneyRow = await readRewardRow(live.db, 'quest_money_reward', 'Level', level);
        const dbcXp = live.serverData?.questXp?.get(level);
        const xp = Array.from({ length: REWARD_TIERS }, (_, i) =>
          xpRow ? parseRewardInt(xpRow[`Difficulty_${i + 1}`]) : (dbcXp?.[i] ?? null),
        );
        const money = Array.from({ length: REWARD_TIERS }, (_, i) =>
          moneyRow ? parseRewardInt(moneyRow[`Money${i}`]) : null,
        );
        return { xp, money };
      }),

    updateQuest: (aggregate) =>
      run(async () => {
        connected();
        const quest = questOf(aggregate.questId);
        // Closing the editor sends the quest back as it is; that is not an edit to the project.
        if (isDeepStrictEqual(quest.aggregate, aggregate)) return true as const;
        // The snapshot and the fidelity report belong to the import, not to the edit.
        quests.put({ ...quest, aggregate });
        return true as const;
      }),

    previewChanges: (questId) =>
      run(async () => {
        const live = connected();
        const quest = questOf(questId);
        const { statements, fixes, scriptContext, entityStatements } = await patchFor(live, quest);
        const entityTables = new Set<string>(ENTITY_TABLES);
        const scriptTables = new Set<string>([...SCRIPT_TABLES, ...ENTITY_TABLES]);
        const own = statements.filter((s) => !scriptTables.has(s.table));
        const before = quest.snapshot?.tables ?? {};
        const after = applyPatchInMemory(before, own, KEY_COLUMNS);
        const differences = compareTables(before, after, KEY_COLUMNS);
        // Script rows live outside the quest's snapshot: compared against what the DB holds now.
        const scriptBefore: Record<string, RawRow[]> = {
          smart_scripts: scriptContext.smartScripts,
          creature_text: scriptContext.creatureText,
          conditions: scriptContext.conditions,
          waypoints: scriptContext.waypoints,
          gossip_menu_option: scriptContext.gossipOptions,
          areatrigger: scriptContext.areatriggers,
          areatrigger_scripts: scriptContext.areatriggerScripts,
          creature_template: scriptContext.creatures,
          gameobject_template: scriptContext.gameobjects,
        };
        // New NPCs and objects: compared against what the database holds for their keys now.
        const keysOf = (table: string, column: string): string[] =>
          entityStatements.flatMap((s) => (s.table === table && s.kind !== 'update' && s.kind !== 'set-flag' ? [String((s.kind === 'insert' ? s.row : s.key)[column] ?? '')] : []));
        const entityBefore: Record<string, RawRow[]> = Object.fromEntries(
          await Promise.all(
            ([['creature_template', 'entry'], ['creature_template_model', 'CreatureID'], ['creature', 'guid'], ['gameobject_template', 'entry'], ['gameobject', 'guid'], ['page_text', 'ID'], ['creature_loot_template', 'Entry'], ['gameobject_loot_template', 'Entry'], ['creature_addon', 'guid'], ['waypoint_data', 'id'], ['creature_equip_template', 'CreatureID']] as const)
              .map(async ([table, column]) => [table, await rowsOrNone(live.db, table, { [column]: [...new Set(keysOf(table, column))] })] as const),
          ),
        );
        const entityAfter = applyPatchInMemory(entityBefore, entityStatements, ENTITY_KEYS);
        differences.push(...compareTables(entityBefore, entityAfter, ENTITY_KEYS));
        const scriptStatementsOnly = statements.filter((s) => scriptTables.has(s.table) && !entityTables.has(s.table)
          && !(s.kind === 'set-flag' && s.table === CREATURE_TABLE && s.column === 'npcflag' && s.bit === QUEST_GIVER_BIT));
        const scriptAfter = applyPatchInMemory(scriptBefore, scriptStatementsOnly, SCRIPT_KEYS);
        differences.push(...compareTables(scriptBefore, scriptAfter, SCRIPT_KEYS));
        // `creature_template` is not part of the snapshot, so the flag updates are named here.
        for (const fix of fixes) {
          differences.push({
            table: CREATURE_TABLE,
            key: `entry=${fix.entry}`,
            column: 'npcflag',
            before: String(fix.npcflag),
            after: String(fix.npcflag | QUEST_GIVER_BIT),
          });
        }
        return differences;
      }),

    spellFacts: (ids) =>
      run(async (): Promise<SpellFactsResult> => {
        const spells = await spellsOf(connected());
        if ('reason' in spells) return { available: false, reason: spells.reason, spells: {} };
        const found: SpellFactsResult['spells'] = {};
        for (const id of ids) {
          const spell = spells.get(id);
          if (spell) found[id] = spell;
        }
        return { available: true, spells: found };
      }),

    groundHeight: (map, x, y) =>
      run(async () => {
        const live = connected();
        const dir = live.serverData?.status.dir;
        if (!dir) return { reason: 'Set the server data folder on the connection to read ground heights.' };
        const name = gridFileName(map, x, y);
        const loaded = await terrainAt(dir, map, x, y);
        if ('reason' in loaded) return loaded;
        const file = loaded.file;
        if (!file) return { reason: `No map file covers this point (${name}).` };
        const z = terrainHeight(file, x, y);
        if (z === null) return { reason: 'There is no ground here (a hole in the terrain).' };
        return { z: Math.round(z * 100) / 100 };
      }),

    mapList: () => run(async () => mapsOf(connected())),

    mapFloors: (map, x, y) =>
      run(async () => {
        const live = connected();
        const dir = live.serverData?.status.dir;
        if (!dir) return { reason: 'Set the server data folder on the connection to read floors.' };
        const tile = await navTileAt(live, dir, map, x, y);
        const terrain = await terrainAt(dir, map, x, y);
        const height = 'file' in terrain && terrain.file ? terrainHeight(terrain.file, x, y) : null;
        const ground = height === null || !Number.isFinite(height) ? null : Math.round(height * 100) / 100;
        return { floors: tile ? floorsAt(tile, x, y) : [], ground };
      }),

    mapSpawns: (map, area) =>
      run(async () => {
        const db = connected().db;
        if (!db.spawnsInBox) return { dots: [], capped: false };
        const [creatures, objects] = await Promise.all([
          db.spawnsInBox('creature', map, area, SPAWN_DOT_CAP + 1),
          db.spawnsInBox('gameobject', map, area, SPAWN_DOT_CAP + 1),
        ]);
        const capped = creatures.length > SPAWN_DOT_CAP || objects.length > SPAWN_DOT_CAP;
        return { dots: [...creatures.slice(0, SPAWN_DOT_CAP), ...objects.slice(0, SPAWN_DOT_CAP)], capped };
      }),

    viewSpawns: (map, area) =>
      run(async () => {
        const db = connected().db;
        if (!db.spawnsForView) return { creatures: [], objects: [], capped: { creatures: false, objects: false } };
        const { creatures, objects } = await db.spawnsForView(map, area, SPAWN_VIEW_CAP + 1);
        return {
          creatures: creatures.slice(0, SPAWN_VIEW_CAP),
          objects: objects.slice(0, SPAWN_VIEW_CAP),
          capped: { creatures: creatures.length > SPAWN_VIEW_CAP, objects: objects.length > SPAWN_VIEW_CAP },
        };
      }),

    projectEntities: () => run(async () => deps.session.entities.get()),

    putProjectEntities: (next) =>
      run(async () => {
        const parsed = projectEntitiesSchema.safeParse(next);
        if (!parsed.success) throw fail('BAD_REQUEST', 'The NPCs, objects and items sent are not valid.');
        deps.session.entities.put(parsed.data);
        return true as const;
      }),

    deleteEntity: (kind, entry) =>
      run(() => asOneStep(async () => {
        const store = projectEntities();
        const list = kind === 'npc' ? 'npcs' : kind === 'object' ? 'objects' : 'items';
        if (!(store[list] as { entry: number }[]).some((e) => e.entry === entry)) throw fail('BAD_REQUEST', `There is no such ${kind === 'npc' ? 'NPC' : kind} in the project.`);
        deps.session.entities.put({ ...store, [list]: (store[list] as { entry: number }[]).filter((e) => e.entry !== entry) } as ProjectEntities);
        // An item is never a giver; an NPC or object comes off every quest's giver cards
        const changed: { questId: number; aggregate: QuestAggregate }[] = [];
        if (kind !== 'item') {
          for (const quest of quests.list()) {
            const edits = emptyGiversOf(quest.aggregate.values, kind === 'npc' ? 'creature' : 'gameobject', entry);
            if (Object.keys(edits).length === 0) continue;
            const aggregate = { ...quest.aggregate, values: { ...quest.aggregate.values, ...edits } };
            quests.put({ ...quest, aggregate });
            changed.push({ questId: quest.questId, aggregate });
          }
        }
        return { entities: deps.session.entities.get(), quests: changed };
      })),

    worldLayer: () =>
      run(async () => {
        const layer = deps.session.world.get();
        const stale = layer.routes.filter((r) => r.original.length > 0 && !r.walkerEntries);
        if (stale.length === 0 || !session) return layer;
        const db = connected().db;
        const filled = new Map<number, { entry: number; name: string }[]>();
        for (const r of stale) filled.set(r.pathId, await readWalkerEntries(db, r.pathId));
        // Re-read the layer: an edit made while the database was read is kept
        const current = deps.session.world.get();
        const next = { ...current, routes: current.routes.map((r) => (!r.walkerEntries && filled.has(r.pathId) ? { ...r, walkerEntries: filled.get(r.pathId)! } : r)) };
        deps.session.world.fill(next);
        return next;
      }),

    worldAddSpawn: (kind, entry, map, at, wanted) =>
      run(async () => {
        const db = connected().db;
        const template = await readTemplateLook(db, kind, entry);
        if (!template) throw fail('BAD_REQUEST', `${kind === 'creature' ? 'NPC' : 'Object'} ${entry} is not in the database.`);
        // A spawn put back by a redo keeps its id, as long as nothing has taken it meanwhile
        const taken = wanted !== undefined && (await readPlacement(db, kind, wanted)) !== null;
        let dbMax = 0;
        try {
          dbMax = (await db.selectMax?.(kind, 'guid')) ?? 0;
        } catch {
          dbMax = 0;
        }
        // Nothing is awaited from here to the layer being put back, so two placements in quick
        // succession cannot be given the same id
        const { npcs, objects } = projectEntities();
        const quests = (kind === 'creature' ? npcs : objects).flatMap((e) => e.spawns.map((s) => s.guid));
        const layer = deps.session.world.get();
        const placed = layer.added.filter((a) => a.kind === kind).map((a) => a.guid);
        if (wanted !== undefined && (taken || quests.includes(wanted) || placed.includes(wanted))) throw fail('BAD_REQUEST', `Spawn ${wanted} is in use`);
        const guid = wanted ?? Math.max(dbMax, ...quests, ...placed, 0) + 1;
        const next = addSpawn(layer, { kind, guid, entry, name: template.name, map, placement: at, look: template.look });
        deps.session.world.put(next);
        return { layer: next, guid };
      }),

    worldMoveSpawn: (kind, guid, to) =>
      run(async () => {
        const db = connected().db;
        // A spawn placed in the view is in the layer only: it just stands where it is put
        if (isAdded(deps.session.world.get(), kind, guid)) {
          const next = moveSpawn(deps.session.world.get(), { kind, guid, entry: 0, name: '', map: 0, original: to }, to);
          deps.session.world.put(next);
          return next;
        }
        const knownIn = (layer: WorldLayer) => layer.spawns.find((s) => s.kind === kind && s.guid === guid);
        // The database is read first and the layer after it, with nothing awaited before the layer is
        // put back, so an edit to another spawn made meanwhile is kept
        let read = knownIn(deps.session.world.get()) ? null : await readPlacement(db, kind, guid);
        let layer = deps.session.world.get();
        let known = knownIn(layer);
        if (!known && !read) {
          // Reverted while the database was not being read: read it now after all
          read = await readPlacement(db, kind, guid);
          layer = deps.session.world.get();
          known = knownIn(layer);
        }
        if (!known && !read) throw fail('BAD_REQUEST', `Spawn ${guid} is no longer in the database.`);
        const spawn = known ?? { kind, guid, entry: read!.entry, name: read!.name, map: read!.map, original: read!.placement };
        const next = moveSpawn(layer, spawn, to);
        deps.session.world.put(next);
        return next;
      }),

    worldRoute: (pathId) =>
      run(async () => {
        const known = deps.session.world.get().routes.find((r) => r.pathId === pathId);
        if (known) return { points: known.current, walkers: known.walkers };
        const { original, walkers } = await routeFromDatabase(pathId);
        return { points: original, walkers };
      }),

    worldSetRoute: (pathId, points, options) =>
      run(async () => {
        const knownIn = (layer: WorldLayer) => layer.routes.find((r) => r.pathId === pathId);
        // A path made in the view is not in the database: it starts from nothing, walked by its one NPC
        const fresh = async () => (options?.isNew ? { original: [] as RoutePoint[], walkers: 1 } : routeFromDatabase(pathId));
        // Database first, layer after, as worldMoveSpawn does, so an edit made meanwhile is kept
        let read = knownIn(deps.session.world.get()) ? null : await fresh();
        let layer = deps.session.world.get();
        let known = knownIn(layer);
        if (!known && !read) {
          read = await fresh();
          layer = deps.session.world.get();
          known = knownIn(layer);
        }
        const route = known ?? { pathId, ...read! };
        const next = setRoute(layer, route, points);
        deps.session.world.put(next);
        return next;
      }),

    worldSetMovement: (guid, to) =>
      run(async () => {
        const db = connected().db;
        const knownIn = (layer: WorldLayer) => movementsOf(layer).find((m) => m.guid === guid);
        // A spawn placed in the view stood still when it was placed, and the database does not have it
        const fromPlaced = (layer: WorldLayer) => {
          const placed = layer.added.find((a) => a.kind === 'creature' && a.guid === guid);
          return placed ? { entry: placed.entry, name: placed.name, map: placed.map, movement: IDLE, addonRow: false, originalRaw: undefined } : null;
        };
        // Database first, layer after, as worldMoveSpawn does, so an edit made meanwhile is kept
        const start = deps.session.world.get();
        let read = knownIn(start) ? null : (fromPlaced(start) ?? (await readMovement(db, guid)));
        let layer = deps.session.world.get();
        let known = knownIn(layer);
        if (!known && !read) {
          read = fromPlaced(layer) ?? (await readMovement(db, guid));
          layer = deps.session.world.get();
          known = knownIn(layer);
        }
        if (!known && !read) throw fail('BAD_REQUEST', `Spawn ${guid} is no longer in the database.`);
        const was = read as Awaited<ReturnType<typeof readMovement>>;
        const edit = known ?? {
          guid, entry: was!.entry, name: was!.name, map: was!.map, addonRow: was!.addonRow, original: was!.movement,
          ...(was!.addonSeed ? { addonSeed: was!.addonSeed } : {}),
          ...(was!.originalRaw ? { originalRaw: was!.originalRaw } : {}),
        };
        const next = setMovement(layer, edit, to);
        deps.session.world.put(next);
        return next;
      }),

    worldRevert: (target) =>
      run(async () => {
        const layer = deps.session.world.get();
        const next =
          target.kind === 'spawn' ? revertSpawn(layer, target.spawnKind, target.guid)
          : target.kind === 'route' ? revertRoute(layer, target.pathId)
          : revertMovement(layer, target.guid);
        const changed =
          next.spawns.length !== layer.spawns.length || next.routes.length !== layer.routes.length || next.added.length !== layer.added.length ||
          movementsOf(next).length !== movementsOf(layer).length;
        if (changed) deps.session.world.put(next);
        return next;
      }),

    worldChanges: () =>
      run(async () => {
        const db = connected().db;
        const layer = deps.session.world.get();
        return [
          ...(await Promise.all(layer.spawns.map(async (s) => ({ ...s, type: 'spawn' as const, drifted: await spawnDrifted(db, s) })))),
          ...(await Promise.all(layer.added.map(async (a) => ({ ...a, type: 'added' as const, drifted: await addedDrifted(db, a) })))),
          ...(await Promise.all(layer.routes.map(async (r) => ({ ...r, type: 'route' as const, drifted: await routeDrifted(db, r) })))),
          ...(await Promise.all(
            movementsOf(layer).map(async (m) => ({ ...m, type: 'movement' as const, drifted: await movementDrifted(db, m, isAdded(layer, 'creature', m.guid)) })),
          )),
        ];
      }),

    historyList: () => run(async () => historyList()),

    historyUndo: () =>
      run(() =>
        queued(() =>
          travel(
            () => ({ direction: 'undo', steps: history.peekUndo() ? [history.peekUndo()!] : [] }),
            () => {
              const step = history.undo();
              return { direction: 'undo', steps: step ? [step] : [] };
            },
          ),
        ),
      ),

    historyRedo: () =>
      run(() =>
        queued(() =>
          travel(
            () => ({ direction: 'redo', steps: history.peekRedo() ? [history.peekRedo()!] : [] }),
            () => {
              const step = history.redo();
              return { direction: 'redo', steps: step ? [step] : [] };
            },
          ),
        ),
      ),

    historyJump: (stepId) => run(() => queued(() => travel(() => history.peekJump(stepId), () => history.jump(stepId)))),

    historyBegin: (label, where) => run(async () => history.begin(label, where)),

    historyEnd: (token) =>
      run(async () => {
        history.end(token);
        return true as const;
      }),

    exportProject: () =>
      run(async () => {
        const live = connected();
        const store = projectEntities();
        const layer: WorldLayer = deps.session.world.get();
        if (store.npcs.length + store.objects.length + store.items.length === 0 && !hasWorldChanges(layer)) {
          throw fail('BAD_REQUEST', 'There are no NPCs, objects, items or world changes to export.');
        }
        await guardProject(live);
        const { apply, revert, schema } = await projectPatch(live);
        const date = patchDate(deps.now());
        const sql = renderPatch(apply, schema, { toolVersion: TOOL_VERSION, date, label: 'Project changes' });
        const revertSql = renderPatch(revert, schema, { toolVersion: TOOL_VERSION, date, label: 'Project changes: revert' });

        // The same folder a quest's patch goes to, numbered per day like quest exports
        const outputDir = deps.exportDirOverride || live.exportDir || deps.defaultExportDir || deps.session.meta().outputDir;
        await deps.fs.ensureDir(outputDir);
        const existing = await deps.fs.listDir(outputDir);
        const sequence = String(existing.filter((name) => name.startsWith(`${date}_`) && name.endsWith('_project.sql')).length).padStart(2, '0');
        const applyPath = join(outputDir, `${date}_${sequence}_project.sql`);
        const revertPath = join(outputDir, `${date}_${sequence}_project_revert.sql`);
        await deps.fs.writeFile(applyPath, sql);
        await deps.fs.writeFile(revertPath, revertSql);
        return { applyPath, revertPath, sql };
      }),

    entitySpawns: (kind, entry) =>
      run(async () => (await connected().db.spawnsOfEntries?.(kind, [entry], REF_SPAWNS_PER_ENTRY)) ?? []),

    findSpawns: (kind, entry) =>
      run(async () => {
        const found = (await connected().db.spawnsOfEntries?.(kind, [entry], FIND_SPAWNS_LIMIT + 1)) ?? [];
        return { spawns: found.slice(0, FIND_SPAWNS_LIMIT), capped: found.length > FIND_SPAWNS_LIMIT };
      }),

    questMapRefs: (questId) =>
      run(async () => {
        const db = connected().db;
        if (!db.spawnsOfEntries) return [];
        const aggregate = questOf(questId).aggregate;
        const { npcs, objects } = questEntities(aggregate);
        // The quest's own NPCs and objects are markers already.
        const own = new Set([...npcs.map((n) => `creature:${n.entry}`), ...objects.map((o) => `gameobject:${o.entry}`)]);
        const wanted = wantedOf(aggregate);
        const refs: QuestMapRef[] = [];
        const seen = new Set<string>();
        for (const want of wanted) {
          if (own.has(`${want.kind}:${want.entry}`)) continue;
          const dots: SpawnDot[] = await db.spawnsOfEntries(want.kind, [want.entry], REF_SPAWNS_PER_ENTRY);
          for (const dot of dots) {
            const key = `${dot.kind}:${dot.guid}`;
            if (seen.has(key)) continue;
            seen.add(key);
            refs.push({ ...dot, role: want.role });
          }
        }
        return refs;
      }),

    questSpawnList: (questIds) =>
      run(async () => {
        const db = connected().db;
        const groups: QuestSpawnGroup[] = [];
        for (const questId of questIds) {
          const aggregate = questOf(questId).aggregate;
          const title = aggregate.values['quest_template.LogTitle'];
          const { npcs, objects } = questEntities(aggregate);
          const spawns: QuestSpawn[] = [];
          const seen = new Set<string>();
          const add = (spawn: QuestSpawn): void => {
            const key = `${spawn.kind}:${spawn.guid}`;
            if (seen.has(key)) return;
            seen.add(key);
            spawns.push(spawn);
          };
          // The quest's own NPCs and objects, where it puts them
          for (const [kind, owners] of [['creature', npcs], ['gameobject', objects]] as const) {
            for (const owner of owners) {
              for (const s of owner.spawns) add({ kind, guid: s.guid, entry: owner.entry, name: owner.name, map: s.map, x: s.x, y: s.y, z: s.z, role: 'own' });
            }
          }
          const own = new Set([...npcs.map((n) => `creature:${n.entry}`), ...objects.map((o) => `gameobject:${o.entry}`)]);
          let cut = 0;
          if (db.spawnsOfEntries) {
            for (const want of wantedOf(aggregate)) {
              if (own.has(`${want.kind}:${want.entry}`)) continue;
              const dots: SpawnDot[] = await db.spawnsOfEntries(want.kind, [want.entry], QUEST_SPAWNS_PER_ENTRY + 1);
              if (dots.length > QUEST_SPAWNS_PER_ENTRY) cut += 1;
              for (const dot of dots.slice(0, QUEST_SPAWNS_PER_ENTRY)) add({ ...dot, role: want.role });
            }
          }
          groups.push({ questId, title: typeof title === 'string' && title !== '' ? title : `Quest ${questId}`, spawns, capped: cut > 0, cut });
        }
        return groups;
      }),

    testCommands: (questId) =>
      run(async () => {
        const live = connected();
        const quest = questOf(questId);
        // What Apply to dev writes: the project patch, then the quest's
        const project = await projectPatch(live);
        const statements = [...project.apply, ...(await patchFor(live, quest)).statements];
        const tables = new Set(statements.map((s) => s.table));
        const creatureTemplates = statements.flatMap((s) => {
          if (s.table !== 'creature_template') return [];
          const entry = s.kind === 'insert' ? s.row.entry : s.key.entry;
          return entry === undefined || entry === null ? [] : [Number(entry)];
        });
        const { npcs, objects } = questEntities(quest.aggregate);
        const spawns = [...npcs, ...objects].flatMap((e) => e.spawns.map((s) => ({ name: e.name || `#${e.entry}`, map: s.map, x: s.x, y: s.y, z: s.z })));
        return gmCommands({
          questId,
          tables,
          creatureTemplates,
          hasStarter: relationOwners(quest.aggregate, 'starter').length > 0,
          spawns,
          newObjectTemplates: objects.length > 0,
          escorts: readScenes(quest.aggregate.values).some((s) => s.steps.some((step) => step.kind === 'startEscort')),
        });
      }),

    questScripts: (questId) =>
      run(async () => {
        const live = connected();
        const aggregate = questOf(questId).aggregate;
        const creatures = new Set<number>();
        const objects = new Set<number>();
        const areas = new Set<number>();
        const addOwner = (owner: SceneOwner): void => {
          if (owner.kind === 'creature' && owner.entry > 0) creatures.add(owner.entry);
          else if (owner.kind === 'gameobject' && owner.entry > 0) objects.add(owner.entry);
          else if (owner.kind === 'areatrigger' && owner.id > 0) areas.add(owner.id);
        };
        readScenes(aggregate.values).forEach((s: QuestScene) => addOwner(s.owner));
        [...relationOwners(aggregate, 'starter'), ...relationOwners(aggregate, 'ender')].forEach(addOwner);
        for (const entry of objectivesOf(aggregate)) {
          if (entry > 0) creatures.add(entry);
          else if (entry < 0) objects.add(-entry);
        }
        const ids = (set: ReadonlySet<number>): string[] => [...set].map(String);
        const [onCreatures, onObjects, onAreas, lists, tagged] = await Promise.all([
          rowsOrNone(live.db, 'smart_scripts', { source_type: '0', entryorguid: ids(creatures) }),
          rowsOrNone(live.db, 'smart_scripts', { source_type: '1', entryorguid: ids(objects) }),
          rowsOrNone(live.db, 'smart_scripts', { source_type: '2', entryorguid: ids(areas) }),
          rowsOrNone(live.db, 'smart_scripts', { source_type: '9', entryorguid: listIdsOf([...creatures, ...objects]) }),
          taggedRows(live.db, 'smart_scripts', 'comment', questId),
        ]);
        return {
          foreign: foreignScenes(questId, [...onCreatures, ...onObjects, ...onAreas, ...lists]),
          unreadable: scenesFromRows(questId, tagged).unreadable,
          missingTables: missingScriptTables(live),
        };
      }),

    validate: (questId) =>
      run(async () => {
        const live = connected();
        return issuesOf(live, questId, questOf(questId).aggregate, refsFor(live));
      }),

    exportQuest: (questId) =>
      run(async () => {
        const live = usable();
        const quest = questOf(questId);
        const issues = await guardWrite(live, quest);
        const { statements, warnings } = await patchFor(live, quest);
        const used = questEntities(quest.aggregate);
        const usesProject = used.npcs.length + used.objects.length + used.items.length;

        const date = patchDate(deps.now());
        const sql = renderPatch(statements, exportSchema(live), { toolVersion: TOOL_VERSION, questId, date });

        // The project file's own folder is only a last resort for harnesses that name no default:
        // a project shared between people must not send their patches into someone else's folders.
        const outputDir = deps.exportDirOverride || live.exportDir || deps.defaultExportDir || deps.session.meta().outputDir;
        await deps.fs.ensureDir(outputDir);
        // Several exports of one quest on one day sit side by side, numbered in the order written.
        const marker = `_quest_${questId}_`;
        const existing = await deps.fs.listDir(outputDir);
        const sequence = existing.filter((name) => name.startsWith(`${date}_`) && name.includes(marker)).length;
        const path = join(
          outputDir,
          patchFileName({ date, sequence, questId, title: textOf(quest.aggregate, TITLE_FIELD) }),
        );
        await deps.fs.writeFile(path, sql);
        quests.markExported(questId, path);

        // What Apply to dev runs before this quest; none when the project has nothing of its own
        const store = projectEntities();
        const hasProject = store.npcs.length + store.objects.length + store.items.length > 0 || hasWorldChanges(deps.session.world.get());
        let projectSql: string | null = null;
        if (hasProject) {
          const project = await projectPatch(live);
          projectSql = renderPatch(project.apply, project.schema, { toolVersion: TOOL_VERSION, date, label: 'Project changes' });
        }
        return { path, sql, warnings, issues: issues.filter((i) => i.severity !== 'error'), usesProject, projectSql };
      }),

    applyToDev: (questId, confirm) =>
      run(async () => {
        if (confirm !== true) {
          throw fail('CONFIRMATION_REQUIRED', 'Applying to the dev database changes it; confirm the SQL first.');
        }
        const live = usable();
        const quest = questOf(questId);
        // The newest dev profile: the one Settings shows and edits (profiles list oldest first).
        const devProfile = deps.store.profiles.list().filter((p) => p.role === 'dev').at(-1);
        if (!devProfile) {
          throw fail('NO_DEV_PROFILE', 'Add a dev database profile before applying a patch to it.');
        }
        await guardWrite(live, quest);
        await guardProject(live);
        const { statements } = await patchFor(live, quest);
        // The project patch first, so the quest's new NPCs, objects and items are there to test
        const project = await projectPatch(live);
        const rendered = [
          ...project.apply.map((s) => renderStatement(s, project.schema)),
          ...statements.map((s) => renderStatement(s, exportSchema(live))),
        ];

        const dev = await deps.openDevDb(deps.store.profiles.getWithPassword(devProfile.id));
        try {
          await dev.execute(rendered);
        } finally {
          await dev.close();
        }
        return { statements: rendered.length };
      }),

    projectState: () => run(async (): Promise<ProjectState> => deps.projects.state()),

    renameProject: (name) =>
      run(async () => {
        deps.projects.rename(name);
        return true as const;
      }),

    newProject: (name) => run(() => deps.projects.newProject(name)),

    openProject: (path) => run(() => deps.projects.open(path)),

    saveProject: () => run(() => deps.projects.save()),

    saveProjectAs: () => run(() => deps.projects.saveAs()),

    recentProjects: () => run(() => deps.projects.recent()),

    forgetRecent: (path) =>
      run(async () => {
        deps.projects.forgetRecent(path);
        return true as const;
      }),

    recoveries: () => run(() => deps.projects.recoveries()),

    restoreRecovery: (id) =>
      run(async () => {
        await deps.projects.restoreRecovery(id);
        return true as const;
      }),

    discardRecovery: (id) =>
      run(async () => {
        await deps.projects.discardRecovery(id);
        return true as const;
      }),
  };
}

/**
 * The round-trip gate as the UI needs it: a quest that cannot even be patched in memory is opened
 * and marked unsafe, rather than refusing to open at all, so the user can see what is wrong with it.
 */
function roundTripOf(
  fresh: { aggregate: QuestAggregate; snapshot: Snapshot },
  schema: SchemaInfo,
): FidelityReport {
  try {
    return verifyRoundTrip({ aggregate: fresh.aggregate, snapshot: fresh.snapshot, schema, registry });
  } catch (error) {
    return {
      ok: false,
      differences: [
        {
          table: '(patch)',
          key: error instanceof Error ? error.message : String(error),
          column: null,
          before: undefined,
          after: undefined,
        },
      ],
    };
  }
}
