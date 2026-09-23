import { join } from 'node:path';
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
import { CONTEXT_TABLES, readItemStarters, type ItemStarter } from '../core/links/context';
import { disconnectedQuests, linkIssues } from '../core/links/issues';
import { questEdges, type ComponentId, type Endpoint } from '../core/links/model';
import { loadLinks, type LinkSnapshot } from '../core/links/service';
import type { QuestAggregate, Snapshot } from '../core/model/aggregate';
import { localesInSnapshot, localizedTextValues } from '../core/model/locales';
import { registry } from '../core/registry';
import { actionName, describeEvent, sourceName } from '../core/smartai/ids';
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
  Project,
  QuestLinks,
  Result,
  StartBadge,
} from '../shared/ipc';
import type { DraftRecord, Store } from './store/store';

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
  defaultOutputDir: string;
  /** A profile to connect to on launch (seeded from `.env` in development). */
  startupProfileId?: number | null;
}

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
}

const REGISTRY_TABLES = registry.tables.map((t) => t.table);
const KEY_COLUMNS = keyColumnsByTable(registry);
const TITLE_FIELD = 'quest_template.LogTitle';
const LEVEL_FIELD = 'quest_template.QuestLevel';
const SEARCH_LIMIT = 50;

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
export function createApi(deps: ApiDeps): Api {
  let session: Session | null = null;

  const project = (): Project => deps.store.projects.ensureDefault(deps.defaultOutputDir);

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

  const draftOf = (questId: number): DraftRecord => {
    const draft = deps.store.drafts.get(project().id, questId);
    if (!draft) throw fail('QUEST_NOT_FOUND', `Quest ${questId} is not open in this project.`);
    return draft;
  };

  const placeAt = (projectId: number, position?: NodePosition): NodePosition =>
    position ?? nextNodePosition(deps.store.drafts.list(projectId).map((d) => ({ x: d.x, y: d.y })));

  /** Every draft in the project: links are read from the user's edits, not the world, wherever one exists. */
  const draftAggregates = (): Map<number, QuestAggregate> =>
    new Map(deps.store.drafts.list(project().id).map((d) => [d.questId, d.aggregate]));

  const linksFor = (live: Session, scope: readonly number[]): Promise<LinkSnapshot> =>
    loadLinks(live.db, scope, draftAggregates(), live.availability.available, live.itemStarters);

  /**
   * A quest's own validation plus what its links say about it. Only for display: the export gate
   * reads errors alone and link issues are warnings, so `guardWrite` has no use for them.
   */
  async function issuesOf(live: Session, questId: number, aggregate: QuestAggregate, refs: RefChecker): Promise<Issue[]> {
    const own = await validateQuest(aggregate, refs);
    return [...own, ...linkIssues(questId, await linksFor(live, [questId]))];
  }

  /** Opens one quest: its draft if the project has one, otherwise a fresh import placed on the canvas. */
  async function openOne(questId: number, position?: NodePosition): Promise<OpenResult> {
    const live = usable();
    const refs = refCheckerFor(live.db);
    const proj = project();
    const draft = deps.store.drafts.get(proj.id, questId);

    // A brand-new quest (never exported) has no row in the live database to import or diff
    // against — asking the importer for it would fail outright, so the draft alone is opened.
    if (draft?.isNew) {
      return {
        questId,
        aggregate: draft.aggregate,
        fidelity: draft.fidelity ?? { ok: true },
        unmodelled: [],
        issues: await issuesOf(live, questId, draft.aggregate, refs),
        hasDraft: true,
        stale: false,
        locales: [],
        importedText: {},
      };
    }

    // The importer is the one place that decides what a usable quest ID is.
    const fresh = await importQuest(live.db, live.schema, registry, questId);
    const fidelity = roundTripOf(fresh, live.schema);
    const unmodelled = listUnmodelled(live.schema, registry, fresh.snapshot);
    // Both branches report the translations against the rows just read, never against a draft.
    const locales = localesInSnapshot(fresh.snapshot);
    const importedText = localizedTextValues(fresh.aggregate, registry);

    if (draft) {
      // The draft is the user's work: it is returned as it stands, wherever it sits, and only
      // the comparison against the freshly read rows says whether the world moved underneath.
      const stale = compareTables(draft.snapshot?.tables ?? {}, fresh.snapshot.tables, KEY_COLUMNS).length > 0;
      // The export gate reads `draft.fidelity`, so the report the UI is about to show has to
      // become the stored one: otherwise the button and the gate answer different questions.
      if (JSON.stringify(draft.fidelity) !== JSON.stringify(fidelity)) {
        deps.store.drafts.save({
          projectId: draft.projectId,
          questId: draft.questId,
          isNew: draft.isNew,
          aggregate: draft.aggregate,
          snapshot: draft.snapshot,
          fidelity,
        });
      }
      return {
        questId,
        aggregate: draft.aggregate,
        fidelity,
        unmodelled,
        issues: await issuesOf(live, questId, draft.aggregate, refs),
        hasDraft: true,
        stale,
        locales,
        importedText,
      };
    }

    const at = placeAt(proj.id, position);
    deps.store.drafts.save({
      projectId: proj.id,
      questId,
      isNew: false,
      aggregate: fresh.aggregate,
      snapshot: fresh.snapshot,
      fidelity,
      x: at.x,
      y: at.y,
    });
    return {
      questId,
      aggregate: fresh.aggregate,
      fidelity,
      unmodelled,
      issues: await issuesOf(live, questId, fresh.aggregate, refs),
      hasDraft: false,
      stale: false,
      locales,
      importedText,
    };
  }

  /** The three gates every write passes: lossless import, no validation errors, and a free ID. */
  async function guardWrite(db: WorldDb, draft: DraftRecord): Promise<Issue[]> {
    if (draft.fidelity !== null && !draft.fidelity.ok) {
      throw fail(
        'FIDELITY',
        `Quest ${draft.questId} did not survive the round-trip check, so exporting it could change data the editor never showed.`,
        { differences: draft.fidelity.differences },
      );
    }
    const issues = await validateQuest(draft.aggregate, refCheckerFor(db));
    if (issues.some((i) => i.severity === 'error')) {
      throw fail('VALIDATION', 'Fix the errors on this quest before exporting it.', { issues });
    }
    if (draft.isNew) await assertIdFree(db, draft.questId);
    return issues;
  }

  async function patchFor(
    live: Session,
    draft: DraftRecord,
  ): Promise<{ statements: PatchStatement[]; warnings: PatchWarning[]; fixes: QuestGiverFix[] }> {
    const fixes = await findQuestGiverFixes(live.db, draft.aggregate.values);
    // Read the neighbouring linked rows now rather than trusting the ones the import saw: the
    // draft may name a creature the quest had nothing to do with when it was opened, and those
    // are exactly the rows a new drop source would otherwise be allocated on top of.
    const linkedContext = await fetchLinkedContext({
      db: live.db,
      registry,
      schema: live.schema,
      tables: draft.snapshot?.tables ?? {},
      values: draft.aggregate.values,
    });
    const { statements, warnings } = buildPatch({
      aggregate: draft.aggregate,
      snapshot: draft.snapshot,
      schema: live.schema,
      registry,
      questGiverFixes: fixes.map((f) => f.entry),
      linkedContext,
    });
    return { statements, warnings, fixes };
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
        };
        return { profileId, schemaHash: schema.hash, drift, blocking };
      }),

    searchQuests: (text) => run(async () => connected().db.searchQuests(text, SEARCH_LIMIT)),

    openQuest: (questId, position) => run(async () => openOne(questId, position)),

    addQuestChain: (questId, position) =>
      run(async () => {
        const live = usable();
        const proj = project();
        const chain = await findQuestChain(live.db, questId, MAX_CHAIN_QUESTS, undefined, live.itemStarters);
        const slots = layoutChain(chain.questIds, chain.links);
        const rootSlot = slots.get(questId) ?? { column: 0, row: 0 };

        // The picked quest lands where it was asked for; with no position, the chain starts in
        // the first column below everything already on the canvas, so it never lands on top of it.
        const drafts = deps.store.drafts.list(proj.id);
        const origin = position
          ? { x: position.x - rootSlot.column * NODE_GRID.x, y: position.y - rootSlot.row * NODE_GRID.y }
          : { x: 0, y: drafts.length === 0 ? 0 : Math.max(...drafts.map((d) => d.y)) + NODE_GRID.y };
        const at = (id: number): NodePosition => {
          const slot = slots.get(id) ?? rootSlot;
          return { x: origin.x + slot.column * NODE_GRID.x, y: origin.y + slot.row * NODE_GRID.y };
        };

        // The picked quest first: if it cannot be opened, nothing else is added either.
        const open = await openOne(questId, at(questId));
        for (const id of chain.questIds) {
          if (id === questId || deps.store.drafts.get(proj.id, id)) continue;
          const fresh = await importQuest(live.db, live.schema, registry, id);
          const place = at(id);
          deps.store.drafts.save({
            projectId: proj.id,
            questId: id,
            isNew: false,
            aggregate: fresh.aggregate,
            snapshot: fresh.snapshot,
            fidelity: roundTripOf(fresh, live.schema),
            x: place.x,
            y: place.y,
          });
        }
        return { open, questIds: chain.questIds, truncated: chain.truncated };
      }),

    newQuest: (position) =>
      run(async () => {
        const live = usable();
        const proj = project();
        const range = { start: proj.idRangeStart, end: proj.idRangeEnd };
        const taken = await collectTakenIds(live.db, range, deps.store.drafts.usedQuestIds(proj.id));
        const questId = allocateQuestId(range, taken);
        const aggregate = createNewAggregate(live.schema, registry, questId);
        const fidelity: FidelityReport = { ok: true };

        const at = placeAt(proj.id, position);
        // Saving the draft straight away is what reserves the ID against the next allocation.
        deps.store.drafts.save({
          projectId: proj.id,
          questId,
          isNew: true,
          aggregate,
          snapshot: null,
          fidelity,
          x: at.x,
          y: at.y,
        });
        return {
          questId,
          aggregate,
          fidelity,
          unmodelled: [],
          issues: await issuesOf(live, questId, aggregate, refCheckerFor(live.db)),
          hasDraft: false,
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
        const refs = refCheckerFor(live.db);
        const drafts = deps.store.drafts.list(project().id);
        const canvasIds = drafts.map((d) => d.questId);
        const onCanvas = new Set(canvasIds);
        // One link snapshot for the whole canvas, so the context is read once rather than per node.
        const snapshot = await loadLinks(
          live.db,
          canvasIds,
          new Map(drafts.map((d) => [d.questId, d.aggregate])),
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
        for (const draft of drafts) {
          const questId = draft.questId;
          const issues = [...(await validateQuest(draft.aggregate, refs)), ...linkIssues(questId, snapshot)];
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
            title: textOf(draft.aggregate, TITLE_FIELD),
            level: numberOf(draft.aggregate, LEVEL_FIELD),
            isNew: draft.isNew,
            exported: draft.lastExportPath !== null,
            unsafe: draft.fidelity !== null && !draft.fidelity.ok,
            errors: issues.filter((i) => i.severity === 'error').length,
            warnings: issues.filter((i) => i.severity === 'warning').length + (notConnected ? 1 : 0),
            x: draft.x,
            y: draft.y,
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
        deps.store.drafts.setPositions(project().id, moves);
        return true as const;
      }),

    removeNode: (questId) =>
      run(async () => {
        connected();
        // Removing a node the user already removed is not an error; the canvas ends up the same.
        deps.store.drafts.remove(project().id, questId);
        return true as const;
      }),

    saveViewport: (viewport) =>
      run(async () => {
        connected();
        deps.store.projects.update({ ...project(), viewport });
        return true as const;
      }),

    lookupNames: (kind: RefKind, ids) =>
      run(async () => {
        const found = await connected().db.lookupNames(kind, ids);
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
            summary: `${describeEvent(row)}: ${actionName(row.actionType)} (${sourceName(row.sourceType)} ${row.entryorguid}, row ${row.id})`,
          })),
          unavailable: live.availability.unavailable,
        };
      }),

    // `xp[i]` is `questxp_dbc.Difficulty_{i+1}` and `money[i]` is `quest_money_reward.Money{i}`,
    // both for the row keyed by `level`; a missing row/table/column or an out-of-range level is
    // all-null rather than an error, since a fork can lack these reference tables entirely.
    rewardTables: (level) =>
      run(async () => {
        const live = connected();
        const nulls = { xp: Array(REWARD_TIERS).fill(null), money: Array(REWARD_TIERS).fill(null) };
        if (!Number.isInteger(level) || level < REWARD_LEVEL_MIN || level > REWARD_LEVEL_MAX) return nulls;

        const xpRow = await readRewardRow(live.db, 'questxp_dbc', 'ID', level);
        const moneyRow = await readRewardRow(live.db, 'quest_money_reward', 'Level', level);
        const xp = Array.from({ length: REWARD_TIERS }, (_, i) =>
          xpRow ? parseRewardInt(xpRow[`Difficulty_${i + 1}`]) : null,
        );
        const money = Array.from({ length: REWARD_TIERS }, (_, i) =>
          moneyRow ? parseRewardInt(moneyRow[`Money${i}`]) : null,
        );
        return { xp, money };
      }),

    saveDraft: (aggregate) =>
      run(async () => {
        connected();
        const draft = draftOf(aggregate.questId);
        // The snapshot and the fidelity report belong to the import, not to the edit.
        const saved = deps.store.drafts.save({
          projectId: draft.projectId,
          questId: draft.questId,
          isNew: draft.isNew,
          aggregate,
          snapshot: draft.snapshot,
          fidelity: draft.fidelity,
        });
        return { updatedAt: saved.updatedAt };
      }),

    previewChanges: (questId) =>
      run(async () => {
        const live = connected();
        const draft = draftOf(questId);
        const { statements, fixes } = await patchFor(live, draft);
        const before = draft.snapshot?.tables ?? {};
        const after = applyPatchInMemory(before, statements, KEY_COLUMNS);
        const differences = compareTables(before, after, KEY_COLUMNS);
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

    validate: (questId) =>
      run(async () => {
        const live = connected();
        return issuesOf(live, questId, draftOf(questId).aggregate, refCheckerFor(live.db));
      }),

    exportQuest: (questId) =>
      run(async () => {
        const live = usable();
        const draft = draftOf(questId);
        const issues = await guardWrite(live.db, draft);
        const { statements, warnings } = await patchFor(live, draft);

        const date = patchDate(deps.now());
        const sql = renderPatch(statements, live.schema, { toolVersion: TOOL_VERSION, questId, date });

        const proj = project();
        await deps.fs.ensureDir(proj.outputDir);
        // Several exports of one quest on one day sit side by side, numbered in the order written.
        const marker = `_quest_${questId}_`;
        const existing = await deps.fs.listDir(proj.outputDir);
        const sequence = existing.filter((name) => name.startsWith(`${date}_`) && name.includes(marker)).length;
        const path = join(
          proj.outputDir,
          patchFileName({ date, sequence, questId, title: textOf(draft.aggregate, TITLE_FIELD) }),
        );
        await deps.fs.writeFile(path, sql);
        deps.store.drafts.markExported(proj.id, questId, path);

        return { path, sql, warnings, issues: issues.filter((i) => i.severity !== 'error') };
      }),

    applyToDev: (questId, confirm) =>
      run(async () => {
        if (confirm !== true) {
          throw fail('CONFIRMATION_REQUIRED', 'Applying to the dev database changes it; confirm the SQL first.');
        }
        const live = usable();
        const draft = draftOf(questId);
        const devProfile = deps.store.profiles.list().find((p) => p.role === 'dev');
        if (!devProfile) {
          throw fail('NO_DEV_PROFILE', 'Add a dev database profile before applying a patch to it.');
        }
        await guardWrite(live.db, draft);
        const { statements } = await patchFor(live, draft);
        const rendered = statements.map((s) => renderStatement(s, live.schema));

        const dev = await deps.openDevDb(deps.store.profiles.getWithPassword(devProfile.id));
        try {
          await dev.execute(rendered);
        } finally {
          await dev.close();
        }
        return { statements: rendered.length };
      }),

    getProject: () =>
      run(async () => {
        connected();
        return project();
      }),

    updateProject: (p) =>
      run(async () => {
        connected();
        return deps.store.projects.update(p);
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
