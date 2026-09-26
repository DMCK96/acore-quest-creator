import type { RawRow, SchemaInfo } from '../db/types';
import { itemFromRow } from '../entities/item-columns';
import {
  newNpc,
  newObject,
  newSpawn,
  NPC_TYPE_VALUE,
  OBJECT_TYPE_VALUE,
  RANK_VALUE,
  type CustomItem,
  type CustomNpc,
  type CustomObject,
  type QuestEntities,
  type Spawn,
} from '../entities/model';
import type { ReadOnlyReason } from '../model/aggregate';
import type { FieldValue, Registry } from '../registry/types';
import type { CandidatePayload, PayloadDependency } from '../../shared/candidate';
import { decodeQuestTables, defaultRow } from './importer';

/**
 * Ascension candidates from the CoA Content Tracker as project quests: the quest's own rows decoded
 * like a quest read from the database, its giver and ender as relation rows, and the NPCs, objects
 * and items it needs that neither the world nor the project has, made from the tracker's records.
 * Pure: the caller reads the world and the project and passes what it found.
 *
 * Every ID is kept as Ascension had it, since other candidates name the same quests, NPCs and items;
 * only spawn guids are the caller's to allocate (they stay 0 here).
 */

export type DependencyKind = 'npc' | 'object' | 'item';

export interface PlanContext {
  schema: SchemaInfo;
  registry: Registry;
  projectQuestIds: ReadonlySet<number>;
  projectEntities: QuestEntities;
  worldQuestIds: ReadonlySet<number>;
  worldHas(kind: DependencyKind, entry: number): boolean;
  worldName(kind: DependencyKind, entry: number): string | null;
}

export interface PlannedReference {
  kind: DependencyKind;
  entry: number;
  name: string;
  where: 'world' | 'project' | 'plan';
}

export interface PlannedQuest {
  questId: number;
  title: string;
  action: 'create' | 'replace' | 'skip';
  reason?: string;
  values: Record<string, FieldValue>;
  readOnly: ReadOnlyReason[];
  creates: QuestEntities;
  references: PlannedReference[];
  unresolved: { kind: DependencyKind; entry: number; reason: string }[];
  notImported: string[];
  givers: { kind: 'npc' | 'object'; entry: number; how: string }[];
  enders: { kind: 'npc' | 'object'; entry: number; how: string }[];
  evaluation: { status: string; tier: number; blockers: string[] };
  spawnsNeeded: { npc: number; object: number };
}

export interface ImportPlan {
  quests: PlannedQuest[];
}

type Row = Record<string, unknown>;

const isRow = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A tracker value as the text a database row carries. */
function asText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number' || typeof v === 'string') return String(v);
  return JSON.stringify(v);
}

const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return v === null || v === undefined || v === '' || !Number.isFinite(n) ? fallback : n;
};

const keyFor = <T extends Record<string, number>>(table: T, value: number): (keyof T & string) | undefined =>
  (Object.keys(table) as (keyof T & string)[]).find((k) => table[k] === value);

/** Columns worth listing as left behind: any value but empty or zero. */
const hasValue = (v: unknown): boolean => v !== null && v !== undefined && v !== '' && v !== 0 && v !== '0';

const GIVER_TABLES = {
  npc: { start: 'creature_queststarter', end: 'creature_questender' },
  object: { start: 'gameobject_queststarter', end: 'gameobject_questender' },
} as const;

/** Spawns from the tracker: world coordinates become spawns, zone-map percentages cannot be placed. */
function spawnsOf(extra: unknown, label: string, notImported: string[]): Spawn[] {
  const list = isRow(extra) && Array.isArray(extra.spawns) ? extra.spawns : [];
  const spawns: Spawn[] = [];
  for (const s of list) {
    if (!isRow(s)) continue;
    if (s.map !== undefined && s.x !== undefined && s.y !== undefined) {
      spawns.push({ ...newSpawn(0), map: num(s.map), x: num(s.x), y: num(s.y), z: num(s.z), o: num(s.o) });
    } else if (s.zone !== undefined) {
      notImported.push(`${label}: a spawn known only as zone ${num(s.zone)} at ${num(s.x_pct)}%, ${num(s.y_pct)}% (place it on the map)`);
    }
  }
  return spawns;
}

const NPC_COLUMNS = new Set(['entry', 'name', 'subname', 'minlevel', 'maxlevel', 'faction', 'rank', 'type', 'HealthModifier', 'DamageModifier', 'npcflag']);
const OBJECT_COLUMNS = new Set(['entry', 'name', 'displayId', 'size', 'type']);
const GOSSIP_BIT = 1;
const QUEST_GIVER_BIT = 2;

function npcFrom(entry: number, record: Row, isGiver: boolean, notImported: string[]): CustomNpc {
  const t = record.creature_template;
  if (!isRow(t)) throw new Error('it has no creature_template');
  const models = Array.isArray(record.creature_template_model) ? record.creature_template_model.filter(isRow) : [];
  const model = models[0];
  for (const [column, value] of Object.entries(t)) if (!NPC_COLUMNS.has(column) && hasValue(value)) notImported.push(`creature_template.${column}`);
  if (models.length > 1) notImported.push(`creature_template_model: ${models.length - 1} more model(s)`);
  const minLevel = Math.max(1, num(t.minlevel, 1));
  const npcflag = num(t.npcflag);
  return {
    ...newNpc(entry),
    name: String(t.name ?? ''),
    subname: String(t.subname ?? ''),
    minLevel,
    maxLevel: Math.max(minLevel, num(t.maxlevel, minLevel)),
    // Faction 0 is no faction at all, which the server treats as hostile to everyone.
    faction: num(t.faction) || 35,
    displayId: num(model?.CreatureDisplayID),
    scale: num(model?.DisplayScale) || 1,
    rank: keyFor(RANK_VALUE, num(t.rank)) ?? 'normal',
    type: keyFor(NPC_TYPE_VALUE, num(t.type)) ?? 'humanoid',
    healthModifier: num(t.HealthModifier) || 1,
    damageModifier: num(t.DamageModifier) || 1,
    questGiver: isGiver || (npcflag & QUEST_GIVER_BIT) !== 0,
    gossip: (npcflag & GOSSIP_BIT) !== 0,
    spawns: spawnsOf(record._extra, `NPC ${entry}`, notImported),
  };
}

function objectFrom(entry: number, record: Row, notImported: string[]): CustomObject {
  const t = record.gameobject_template;
  if (!isRow(t)) throw new Error('it has no gameobject_template');
  for (const [column, value] of Object.entries(t)) if (!OBJECT_COLUMNS.has(column) && hasValue(value)) notImported.push(`gameobject_template.${column}`);
  const typeNumber = num(t.type);
  const type = keyFor(OBJECT_TYPE_VALUE, typeNumber);
  if (type === undefined) notImported.push(`gameobject_template.type (${typeNumber})`);
  return {
    ...newObject(entry),
    name: String(t.name ?? ''),
    type: type ?? 'goober',
    displayId: num(t.displayId),
    size: num(t.size) || 1,
    spawns: spawnsOf(record._extra, `Object ${entry}`, notImported),
  };
}

function itemFrom(entry: number, record: Row, notImported: string[]): CustomItem {
  const t = record.item_template;
  if (!isRow(t)) throw new Error('it has no item_template');
  const extra = isRow(record._extra) ? record._extra : {};
  const stats = Array.isArray(extra.stats) ? extra.stats.filter(isRow).map((s) => ({ type: num(s.type), value: num(s.value) })) : [];
  if (isRow(extra.unmapped)) for (const [column, word] of Object.entries(extra.unmapped)) notImported.push(`item_template.${column} (${String(word)})`);
  const row: Record<string, string | number | null> = {};
  for (const [column, value] of Object.entries(t)) row[column] = asText(value);
  return { ...itemFromRow(row, stats), entry };
}

export function planCandidateImport(payloads: readonly CandidatePayload[], ctx: PlanContext): ImportPlan {
  const planned = new Map<string, { name: string }>();
  const inProject = new Map<string, string>([
    ...ctx.projectEntities.npcs.map((n) => [`npc:${n.entry}`, n.name] as [string, string]),
    ...ctx.projectEntities.objects.map((o) => [`object:${o.entry}`, o.name] as [string, string]),
    ...ctx.projectEntities.items.map((i) => [`item:${i.entry}`, i.name] as [string, string]),
  ]);
  const byTable = new Map(ctx.registry.tables.map((t) => [t.table, t]));

  const quests = payloads.map((payload): PlannedQuest => {
    const template = isRow(payload.quest.quest_template) ? payload.quest.quest_template : {};
    const questId = num(template.ID);
    const title = String(template.LogTitle ?? '');
    const empty: PlannedQuest = {
      questId, title, action: 'create', values: {}, readOnly: [], creates: { npcs: [], objects: [], items: [] }, references: [], unresolved: [],
      notImported: [], givers: payload.givers.map(({ kind, entry, how }) => ({ kind, entry, how })),
      enders: payload.enders.map(({ kind, entry, how }) => ({ kind, entry, how })), evaluation: payload.evaluation, spawnsNeeded: { npc: 0, object: 0 },
    };
    if (ctx.worldQuestIds.has(questId)) {
      return { ...empty, action: 'skip', reason: `Quest ${questId} is already in the world DB (the tracker's last snapshot is older).` };
    }
    const plan: PlannedQuest = { ...empty, action: ctx.projectQuestIds.has(questId) ? 'replace' : 'create' };

    // The quest's own rows, laid over each table's defaults so a column the tracker lacks keeps its default.
    const tables: Record<string, RawRow[]> = {};
    for (const [table, value] of Object.entries(payload.quest)) {
      const def = byTable.get(table);
      const columns = ctx.schema.tables[table];
      if (!def || !columns) {
        plan.notImported.push(table);
        continue;
      }
      const known = new Set(columns.map((c) => c.name));
      const rows = (Array.isArray(value) ? value : [value]).filter(isRow);
      tables[table] = rows.map((source) => {
        const row: Record<string, string | null> = def.cardinality === 'one' ? { ...defaultRow(table, ctx.schema, def.keyColumns[0]!, questId) } : {};
        for (const [column, v] of Object.entries(source)) {
          if (known.has(column)) row[column] = asText(v);
          else plan.notImported.push(`${table}.${column}`);
        }
        return row;
      });
    }
    const decoded = decodeQuestTables(ctx.schema, ctx.registry, questId, tables);
    plan.values = { ...decoded.values, 'quest_template.ID': questId };
    plan.readOnly = decoded.readOnly;
    for (const role of ['start', 'end'] as const) {
      const people = role === 'start' ? payload.givers : payload.enders;
      for (const kind of ['npc', 'object'] as const) {
        const table = GIVER_TABLES[kind][role];
        if (!ctx.schema.tables[table]) continue;
        const ids = [...new Set(people.filter((p) => p.kind === kind).map((p) => p.entry))];
        plan.values[table] = ids.map((id) => ({ id }));
      }
    }

    const giverKeys = new Set(payload.givers.concat(payload.enders).map((g) => `${g.kind}:${g.entry}`));
    const seen = new Set<string>();
    for (const dep of payload.dependencies) {
      const key = `${dep.kind}:${dep.entry}`;
      if (seen.has(key)) continue;
      seen.add(key);
      placeDependency(dep, key, giverKeys.has(key), plan);
    }
    plan.spawnsNeeded = {
      npc: plan.creates.npcs.reduce((n, e) => n + e.spawns.length, 0),
      object: plan.creates.objects.reduce((n, e) => n + e.spawns.length, 0),
    };
    return plan;
  });

  function placeDependency(dep: PayloadDependency, key: string, isGiver: boolean, plan: PlannedQuest): void {
    const { kind, entry } = dep;
    const mine = inProject.get(key);
    if (mine !== undefined) {
      plan.references.push({ kind, entry, name: mine, where: 'project' });
      return;
    }
    const earlier = planned.get(key);
    if (earlier) {
      plan.references.push({ kind, entry, name: earlier.name, where: 'plan' });
      return;
    }
    // Checked against the world as it is now, not the tracker's snapshot: an entry taken since is never overwritten.
    if (ctx.worldHas(kind, entry)) {
      plan.references.push({ kind, entry, name: ctx.worldName(kind, entry) ?? '', where: 'world' });
      return;
    }
    if (dep.record === null) {
      plan.unresolved.push({ kind, entry, reason: 'The tracker has no data for it.' });
      return;
    }
    const left: string[] = [];
    try {
      if (kind === 'npc') {
        const npc = npcFrom(entry, dep.record, isGiver, left);
        plan.creates.npcs.push(npc);
        planned.set(key, { name: npc.name });
      } else if (kind === 'object') {
        const object = objectFrom(entry, dep.record, left);
        plan.creates.objects.push(object);
        planned.set(key, { name: object.name });
      } else {
        const item = itemFrom(entry, dep.record, left);
        plan.creates.items.push(item);
        planned.set(key, { name: item.name });
      }
      plan.notImported.push(...left);
    } catch (error) {
      plan.unresolved.push({ kind, entry, reason: `Its data could not be read: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  return { quests };
}
