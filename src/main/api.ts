import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { layoutChain, NODE_GRID, nextNodePosition } from '../core/canvas/layout';
import type { DevDb } from '../core/db/dev-db';
import type { ColumnInfo, RawRow, RefKind, SchemaInfo } from '../core/db/types';
import { UnknownColumnError, UnknownTableError, type WorldDb } from '../core/db/world-db';
import { buildPatch, type PatchStatement, type PatchWarning } from '../core/export/build-patch';
import { findQuestGiverFixes, type QuestGiverFix } from '../core/export/quest-giver';
import { patchFileName, renderPatch, renderStatement } from '../core/export/render-patch';
import { allocateQuestId, assertIdFree, collectTakenIds } from '../core/ids/allocator';
import { importQuest } from '../core/import/importer';
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
import type {
  Api,
  ApiError,
  CanvasNode,
  ErrorCode,
  NodeGroup,
  NodeLink,
  NodePosition,
  OpenResult,
  ProfileInput,
  ProjectState,
  QuestLinks,
  Result,
  SpellFactsResult,
  StartBadge,
} from '../shared/ipc';
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
import { ENTITY_KEYS, ENTITY_TABLES, readEntityContext } from '../core/entities/context';
import { ENTITIES_FIELD, NPC_TYPE_VALUE, OBJECT_TYPE_VALUE, RANK_VALUE, readEntities, writeEntities, type QuestEntities } from '../core/entities/model';
import { entityIssues } from '../core/entities/validate';
import { gmCommands } from '../core/testing/gm';
import { TerrainFormatError, gridFileName, parseMapFile, terrainHeight, type TerrainFile } from '../core/game/terrain';
import { loadServerData, readServerDataFile, type ServerData, type ServerDataFiles } from './server-data';
import { CAST_TIMES_FILE, RANGE_FILE, readSpellIndex, SPELL_FILE, spellDetail, spellLabel, type SpellIndex } from '../core/game/spells';
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
}

const NO_SERVER_DATA_FILES: ServerDataFiles = { read: async () => null, isDir: async () => false };

/** The live world connection plus everything that was read from it once, at connect time. */
interface Session {
  profileId: number;
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
}

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

  const linksFor = (live: Session, scope: readonly number[]): Promise<LinkSnapshot> =>
    loadLinks(live.db, scope, projectAggregates(), live.availability.available, live.itemStarters);

  /**
   * A quest's own validation plus what its links say about it. Only for display: the export gate
   * reads errors alone and link issues are warnings, so `guardWrite` has no use for them.
   */
  async function issuesOf(live: Session, questId: number, aggregate: QuestAggregate, refs: RefChecker): Promise<Issue[]> {
    const own = await validateQuest(aggregate, refs);
    return [
      ...own,
      ...(await scriptIssues(live, aggregate)),
      ...(await newEntityIssues(live, aggregate)),
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
  const exportSchema = (live: Session): SchemaInfo => ({
    ...live.schema,
    tables: { ...live.scriptSchema.tables, ...live.schema.tables },
  });

  const missingScriptTables = (live: Session): string[] =>
    SCRIPT_TABLES.filter((t) => !live.scriptSchema.tables[t]);

  /** The four NPC-or-object objectives as signed entries: creatures positive, objects negative, none 0. */
  function objectivesOf(aggregate: QuestAggregate): number[] {
    const rows = aggregate.values['quest_template.RequiredNpcOrGo'];
    const list = Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
    return [0, 1, 2, 3].map((i) => {
      const target = list[i]?.target as { target?: string; id?: number } | undefined;
      if (!target || typeof target.id !== 'number') return 0;
      return target.target === 'gameobject' ? -target.id : target.id;
    });
  }

  /** The quest's starters or enders as scene owners. */
  function relationOwners(aggregate: QuestAggregate, kind: 'starter' | 'ender'): SceneOwner[] {
    const owners: SceneOwner[] = [];
    for (const [fieldId, ownerKind] of [
      [`creature_quest${kind}`, 'creature'],
      [`gameobject_quest${kind}`, 'gameobject'],
    ] as const) {
      const rows = aggregate.values[fieldId];
      if (!Array.isArray(rows)) continue;
      for (const row of rows as Array<Record<string, unknown>>) {
        if (typeof row.id === 'number' && row.id > 0) owners.push({ kind: ownerKind, entry: row.id });
      }
    }
    return owners;
  }

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

  /** The items the quest asks for: their drops are set in Objectives, never by a loot list. */
  function questItemsOf(aggregate: QuestAggregate): number[] {
    const rows = aggregate.values['quest_template.RequiredItems'];
    if (!Array.isArray(rows)) return [];
    return (rows as Array<Record<string, unknown>>).flatMap((r) => (typeof r.item === 'number' && r.item > 0 ? [r.item] : []));
  }

  /** Every new NPC and object in the project, from every quest. */
  function projectEntities(): QuestEntities {
    const all: QuestEntities = { npcs: [], objects: [] };
    for (const quest of quests.list()) {
      const { npcs, objects } = readEntities(quest.aggregate.values);
      all.npcs.push(...npcs);
      all.objects.push(...objects);
    }
    return all;
  }

  /**
   * Reference checks that also know the project's new NPCs and objects: they exist, and a new NPC
   * counts as a quest giver because export gives it the flag whenever it starts or ends a quest.
   */
  function refsFor(live: Session): RefChecker {
    const base = refCheckerFor(live.db);
    return {
      exists(kind, id) {
        const { npcs, objects } = projectEntities();
        if (kind === 'creature' && npcs.some((n) => n.entry === id)) return Promise.resolve(true);
        if (kind === 'gameobject' && objects.some((o) => o.entry === id)) return Promise.resolve(true);
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

  async function newEntityIssues(live: Session, aggregate: QuestAggregate): Promise<Issue[]> {
    const entities = readEntities(aggregate.values);
    if (entities.npcs.length + entities.objects.length === 0) return [];
    const [creatures, objects] = await Promise.all([
      rowsOrNone(live.db, 'creature_template', { entry: entities.npcs.map((n) => String(n.entry)) }),
      rowsOrNone(live.db, 'gameobject_template', { entry: entities.objects.map((o) => String(o.entry)) }),
    ]);
    const dbNames = new Map<string, string>([
      ...creatures.map((r) => [`creature:${r.entry}`, r.name ?? ''] as [string, string]),
      ...objects.map((r) => [`gameobject:${r.entry}`, r.name ?? ''] as [string, string]),
    ]);
    // Only a spell list already loaded: a validation run must not wait for, or start, the big read.
    const spells = live.spellsReady;
    return entityIssues({ entities, dbNames, questItems: questItemsOf(aggregate), knownSpell: spells ? (id) => spells.get(id) !== undefined : null });
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

  /**
   * Every SmartAI row of the quest compiled against the world DB right now: its scenes, then the
   * fights of its new NPCs around them. Every project NPC goes to the fight compiler, so the rows of
   * a fight since removed are deleted.
   */
  async function compileFor(live: Session, aggregate: QuestAggregate): Promise<{ context: ScriptContext; compiled: CompiledScripts }> {
    const scenes = readScenes(aggregate.values);
    const { npcs } = readEntities(aggregate.values);
    const fighters = npcs.filter((n) => !fightIsEmpty(n.fight)).map((n) => n.entry);
    const context = await readScriptContext(live.db, aggregate.questId, scenes, fighters);
    const objectives = objectivesOf(aggregate);
    const sceneRows = compileScenes({ questId: aggregate.questId, scenes, objectives, context });
    const fightRows = compileFights({ questId: aggregate.questId, npcs, objectives, context, taken: sceneRows });
    return { context, compiled: mergeCompiled(sceneRows, fightRows) };
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
      ...(await newEntityIssues(live, quest.aggregate)),
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
    const entities = readEntities(quest.aggregate.values);
    const givers = [...relationOwners(quest.aggregate, 'starter'), ...relationOwners(quest.aggregate, 'ender')]
      .flatMap((o) => (o.kind === 'creature' ? [o.entry] : []));
    const entityContext = await readEntityContext(live.db, quest.questId, entities);
    const newEntities = scriptStatements(
      compileEntities({ questId: quest.questId, entities, givers, questItems: questItemsOf(quest.aggregate), context: entityContext }),
      exportSchema(live),
    );
    const of = (list: readonly PatchStatement[], kind: PatchStatement['kind']) => list.filter((s) => s.kind === kind);
    // Deletes before anything is written; new NPCs and objects before the flags and updates quest
    // scripting puts on them; the quest's and the scenes' rows last.
    const merged = [
      ...of(statements, 'delete'), ...of(scripts.statements, 'delete'), ...of(newEntities.statements, 'delete'),
      ...of(newEntities.statements, 'insert'),
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

    startupProfile: () => run(async () => deps.startupProfileId ?? null),

    connect: (profileId) =>
      run(async () => {
        const profile = deps.store.profiles.getWithPassword(profileId);
        const db = await deps.openWorldDb(profile);
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
        const drift = diffSchema(schema, registry);
        const blocking = hasBlockingDrift(drift);
        const serverData = await loadServerData(profile.dbcDir ?? '', deps.serverDataFiles ?? NO_SERVER_DATA_FILES);
        const scriptSchema = await loadSchema(db, [...new Set<string>([...SCRIPT_TABLES, ...ENTITY_TABLES])]);
        // Swapping connections must not leave the old one open.
        if (session && session.db !== db) await session.db.close();
        session = {
          profileId,
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
        return { profileId, schemaHash: schema.hash, drift, blocking, serverData: serverData?.status ?? null };
      }),

    chooseServerDataDir: () => run(async () => (deps.chooseDirectory ? await deps.chooseDirectory() : null)),

    searchQuests: (text) => run(async () => connected().db.searchQuests(text, SEARCH_LIMIT)),
    searchEntities: (kind, text) =>
      run(async () => {
        if (kind === 'spell') {
          const spells = await spellsOf(connected());
          if ('reason' in spells) return [];
          return spells.search(text, ENTITY_SEARCH_LIMIT).map((f) => ({ id: f.id, name: spellLabel(f), detail: spellDetail(f) }));
        }
        const found = await connected().db.searchEntities(kind, text, ENTITY_SEARCH_LIMIT);
        if (kind !== 'creature' && kind !== 'gameobject') return found;
        const { npcs, objects } = projectEntities();
        const needle = text.trim().toLowerCase();
        if (needle === '') return found;
        const mine = (kind === 'creature' ? npcs : objects)
          .filter((e) => e.name.toLowerCase().includes(needle) || String(e.entry) === needle)
          .map((e) => ({ id: e.entry, name: e.name || `New ${kind === 'creature' ? 'NPC' : 'object'}`, detail: 'new' }));
        const ids = new Set(mine.map((h) => h.id));
        return [...mine, ...found.filter((h) => !ids.has(h.id))].slice(0, ENTITY_SEARCH_LIMIT);
      }),

    allocateIds: (kind, count) =>
      run(async () => {
        const live = connected();
        const [table, column] = {
          creature: ['creature_template', 'entry'],
          gameobject: ['gameobject_template', 'entry'],
          creatureSpawn: ['creature', 'guid'],
          gameobjectSpawn: ['gameobject', 'guid'],
          page: ['page_text', 'ID'],
        }[kind] as [string, string];
        let dbMax = 0;
        try {
          dbMax = (await live.db.selectMax?.(table, column)) ?? 0;
        } catch {
          dbMax = 0;
        }
        const { npcs, objects } = projectEntities();
        const used =
          kind === 'creature' ? npcs.map((n) => n.entry)
          : kind === 'gameobject' ? objects.map((o) => o.entry)
          : kind === 'creatureSpawn' ? npcs.flatMap((n) => n.spawns.map((s) => s.guid))
          : kind === 'page' ? objects.flatMap((o) => o.pages.map((p) => p.id))
          : objects.flatMap((o) => o.spawns.map((s) => s.guid));
        const base = Math.max(dbMax, ...used, 0);
        return Array.from({ length: count }, (_, i) => base + i + 1);
      }),

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
          return {
            name: row.name ?? '', subname: row.subname ?? '',
            minLevel: numberOf(row.minlevel, 1), maxLevel: numberOf(row.maxlevel, 1), faction: numberOf(row.faction, 35),
            rank: nameOf(RANK_VALUE, numberOf(row.rank), 'normal'), type: nameOf(NPC_TYPE_VALUE, numberOf(row.type), 'none'),
            healthModifier: numberOf(row.HealthModifier, 1), damageModifier: numberOf(row.DamageModifier, 1),
            displayId: numberOf(model?.CreatureDisplayID), scale: numberOf(model?.DisplayScale, 1),
          };
        }
        const [row] = await rowsOrNone(live.db, 'gameobject_template', { entry: [String(entry)] });
        if (!row) return null;
        return {
          name: row.name ?? '', type: nameOf(OBJECT_TYPE_VALUE, numberOf(row.type), 'generic'),
          displayId: numberOf(row.displayId), size: numberOf(row.size, 1),
        };
      }),

    openQuest: (questId, position) => run(async () => openOne(questId, position)),

    addQuestChain: (questId, position) =>
      run(async () => {
        const live = usable();
        const chain = await findQuestChain(live.db, questId, MAX_CHAIN_QUESTS, undefined, live.itemStarters);
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
      }),

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
          values: { ...created.values, [SCRIPTS_FIELD]: writeScenes([]), [ENTITIES_FIELD]: writeEntities({ npcs: [], objects: [] }) },
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
        const canvasIds = projectQuests.map((d) => d.questId);
        const onCanvas = new Set(canvasIds);
        // One link snapshot for the whole canvas, so the context is read once rather than per node.
        const snapshot = await loadLinks(
          live.db,
          canvasIds,
          new Map(projectQuests.map((d) => [d.questId, d.aggregate])),
          live.availability.available,
          live.itemStarters,
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
        // New NPCs and objects are not in the database until the quest is applied.
        const { npcs, objects } = projectEntities();
        const mine = kind === 'creature' ? npcs : kind === 'gameobject' ? objects : [];
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
            ([['creature_template', 'entry'], ['creature_template_model', 'CreatureID'], ['creature', 'guid'], ['gameobject_template', 'entry'], ['gameobject', 'guid'], ['page_text', 'ID'], ['creature_loot_template', 'Entry'], ['gameobject_loot_template', 'Entry']] as const)
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
        const files = deps.serverDataFiles ?? NO_SERVER_DATA_FILES;
        // The folder may be the server's DataDir or its dbc folder; maps/ sits in the one, beside the other.
        const candidates = [join(dir, 'maps'), join(dir, '..', 'maps')];
        const key = `${dir}|${name}`;
        let file = terrainCache.get(key);
        if (file === undefined) {
          file = null;
          for (const folder of candidates) {
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
        }
        if (!file) return { reason: `No map file covers this point (${name}).` };
        const z = terrainHeight(file, x, y);
        if (z === null) return { reason: 'There is no ground here (a hole in the terrain).' };
        return { z: Math.round(z * 100) / 100 };
      }),

    testCommands: (questId) =>
      run(async () => {
        const live = connected();
        const quest = questOf(questId);
        const { statements } = await patchFor(live, quest);
        const tables = new Set(statements.map((s) => s.table));
        const creatureTemplates = statements.flatMap((s) => {
          if (s.table !== 'creature_template') return [];
          const entry = s.kind === 'insert' ? s.row.entry : s.key.entry;
          return entry === undefined || entry === null ? [] : [Number(entry)];
        });
        const { npcs, objects } = readEntities(quest.aggregate.values);
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

        const date = patchDate(deps.now());
        const sql = renderPatch(statements, exportSchema(live), { toolVersion: TOOL_VERSION, questId, date });

        const { outputDir } = deps.session.meta();
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

        return { path, sql, warnings, issues: issues.filter((i) => i.severity !== 'error') };
      }),

    applyToDev: (questId, confirm) =>
      run(async () => {
        if (confirm !== true) {
          throw fail('CONFIRMATION_REQUIRED', 'Applying to the dev database changes it; confirm the SQL first.');
        }
        const live = usable();
        const quest = questOf(questId);
        const devProfile = deps.store.profiles.list().find((p) => p.role === 'dev');
        if (!devProfile) {
          throw fail('NO_DEV_PROFILE', 'Add a dev database profile before applying a patch to it.');
        }
        await guardWrite(live, quest);
        const { statements } = await patchFor(live, quest);
        const rendered = statements.map((s) => renderStatement(s, exportSchema(live)));

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
