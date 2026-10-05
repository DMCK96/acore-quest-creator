import { isDeepStrictEqual } from 'node:util';
import type { RawRow, Where } from '../../core/db/types';
import type { WorldDb } from '../../core/db/world-db';
import { spawnEntryColumn } from '../../core/db/spawns';
import { OBJECT_TYPE_VALUE, type ProjectEntities } from '../../core/entities/model';
import type { GroupContext, GroupMember, SpawnGroup } from '../../core/world/groups';
import { groupsOf, type WorldLayer, type WorldSpawnKind } from '../../core/world/layer';
import { readPlacement } from './world-api';

/**
 * What spawn groups read from the world database: the server's pools (pool_template, pool_creature,
 * pool_gameobject, pool_pool) as groups, and what checking a group needs to know about its members.
 * A database without the pool tables has no groups.
 */

type Kind = 'npc' | 'object';
type Move = { kind: Kind; guid: number };

const num = (value: string | null | undefined, fallback = 0): number => {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const spawnTable = (kind: Kind): WorldSpawnKind => (kind === 'npc' ? 'creature' : 'gameobject');
const poolTable = (kind: Kind): 'pool_creature' | 'pool_gameobject' => (kind === 'npc' ? 'pool_creature' : 'pool_gameobject');

const hasTable = async (db: WorldDb, table: string): Promise<boolean> => (await db.columns(table)).length > 0;

/** A table's rows, none when the database does not have it */
const rowsOf = async (db: WorldDb, table: string, where: Where): Promise<RawRow[]> => ((await hasTable(db, table)) ? db.selectRows(table, where) : []);

/** Rows whose `column` is one of `values`, asked for a few thousand at a time */
async function rowsIn(db: WorldDb, table: string, column: string, values: readonly string[]): Promise<RawRow[]> {
  const out: RawRow[] = [];
  for (let i = 0; i < values.length; i += 2000) out.push(...(await rowsOf(db, table, { [column]: values.slice(i, i + 2000) })));
  return out;
}

const byNumber = (column: string) => (a: RawRow, b: RawRow) => num(a[column]) - num(b[column]);

/** Each spawn's entry and map by guid, read from its table */
async function spawnRows(db: WorldDb, kind: Kind, guids: readonly string[]): Promise<Map<string, { entry: number; map: number }>> {
  const table = spawnTable(kind);
  const out = new Map<string, { entry: number; map: number }>();
  if (guids.length === 0 || !(await hasTable(db, table))) return out;
  const entryColumn = spawnEntryColumn(table, (await db.columns(table)).map((c) => c.name));
  for (const row of await rowsIn(db, table, 'guid', guids)) out.set(row.guid ?? '', { entry: num(row[entryColumn]), map: num(row.map) });
  return out;
}

/**
 * A pool as a group, with the rows it was read from as its original; null when there is no such pool.
 * Members are its NPCs, then its objects, then its groups, each by guid or id; its map is its first
 * spawn's, else its first group's.
 */
export async function readGroup(db: WorldDb, id: number, seen: ReadonlySet<number> = new Set()): Promise<SpawnGroup | null> {
  const key = String(id);
  const [template] = await rowsOf(db, 'pool_template', { entry: key });
  if (!template) return null;
  const creatures = [...(await rowsOf(db, 'pool_creature', { pool_entry: key }))].sort(byNumber('guid'));
  const objects = [...(await rowsOf(db, 'pool_gameobject', { pool_entry: key }))].sort(byNumber('guid'));
  const children = [...(await rowsOf(db, 'pool_pool', { mother_pool: key }))].sort(byNumber('pool_id'));
  const npcSpawns = await spawnRows(db, 'npc', creatures.map((r) => r.guid ?? ''));
  const objectSpawns = await spawnRows(db, 'object', objects.map((r) => r.guid ?? ''));
  const spawnMember = (kind: Kind, row: RawRow, spawns: Map<string, { entry: number; map: number }>): GroupMember => ({
    type: 'spawn', kind, guid: num(row.guid), entry: spawns.get(row.guid ?? '')?.entry ?? 0, chance: num(row.chance),
  });
  const members: GroupMember[] = [
    ...creatures.map((r) => spawnMember('npc', r, npcSpawns)),
    ...objects.map((r) => spawnMember('object', r, objectSpawns)),
    ...children.map((r): GroupMember => ({ type: 'group', id: num(r.pool_id), chance: num(r.chance) })),
  ];
  const firstSpawn = [...creatures.map((r) => npcSpawns.get(r.guid ?? '')), ...objects.map((r) => objectSpawns.get(r.guid ?? ''))].find((s) => s !== undefined);
  let map = firstSpawn?.map ?? null;
  if (map === null) {
    const deeper = new Set([...seen, id]);
    for (const child of children) {
      const childId = num(child.pool_id);
      if (deeper.has(childId)) continue;
      const read = await readGroup(db, childId, deeper);
      if (read && read.members.length > 0) {
        map = read.map;
        break;
      }
    }
  }
  const [event] = await rowsOf(db, 'game_event_pool', { pool_entry: key });
  return {
    id,
    name: template.description ?? '',
    map: map ?? 0,
    maxActive: num(template.max_limit),
    members,
    origin: {
      kind: 'existing',
      original: {
        template: { ...template },
        members: [
          ...creatures.map((row) => ({ table: 'pool_creature' as const, row: { ...row } })),
          ...objects.map((row) => ({ table: 'pool_gameobject' as const, row: { ...row } })),
          ...children.map((row) => ({ table: 'pool_pool' as const, row: { ...row } })),
        ],
        event: event ? { ...event } : null,
      },
    },
  };
}

/** Every pool in the database with its map and member count, read in a few passes rather than one pool at a time */
export async function listPools(db: WorldDb): Promise<{ id: number; name: string; maxActive: number; members: number; map: number | null }[]> {
  const templates = await rowsOf(db, 'pool_template', {});
  if (templates.length === 0) return [];
  const creatures = [...(await rowsOf(db, 'pool_creature', {}))].sort(byNumber('guid'));
  const objects = [...(await rowsOf(db, 'pool_gameobject', {}))].sort(byNumber('guid'));
  const children = [...(await rowsOf(db, 'pool_pool', {}))].sort(byNumber('pool_id'));
  const npcSpawns = await spawnRows(db, 'npc', creatures.map((r) => r.guid ?? ''));
  const objectSpawns = await spawnRows(db, 'object', objects.map((r) => r.guid ?? ''));
  const spawnMap = new Map<number, number>();
  const count = new Map<number, number>();
  for (const [rows, spawns] of [[creatures, npcSpawns], [objects, objectSpawns]] as const) {
    for (const row of rows) {
      const pool = num(row.pool_entry);
      count.set(pool, (count.get(pool) ?? 0) + 1);
      const spawn = spawns.get(row.guid ?? '');
      if (spawn && !spawnMap.has(pool)) spawnMap.set(pool, spawn.map);
    }
  }
  const childrenOf = new Map<number, number[]>();
  for (const row of children) {
    const mother = num(row.mother_pool);
    childrenOf.set(mother, [...(childrenOf.get(mother) ?? []), num(row.pool_id)]);
    count.set(mother, (count.get(mother) ?? 0) + 1);
  }
  const mapOf = (id: number, seen: Set<number>): number | null => {
    if (spawnMap.has(id)) return spawnMap.get(id)!;
    if (seen.has(id)) return null;
    seen.add(id);
    for (const child of childrenOf.get(id) ?? []) {
      const found = mapOf(child, seen);
      if (found !== null) return found;
    }
    return null;
  };
  return templates.map((t) => {
    const id = num(t.entry);
    return { id, name: t.description ?? '', maxActive: num(t.max_limit), members: count.get(id) ?? 0, map: mapOf(id, new Set()) };
  });
}

/** Whether the database has moved off a group's original since it was read; a new group drifts when the database has a pool with its id */
export async function groupDrifted(db: WorldDb, group: SpawnGroup): Promise<boolean> {
  const now = await readGroup(db, group.id);
  if (group.origin.kind === 'new') return now !== null;
  if (!now || now.origin.kind !== 'existing') return true;
  return !isDeepStrictEqual(now.origin.original, group.origin.original);
}

/** The group, other than a removed one, in the layer that holds a member; null when none does */
function layerHolder(layer: WorldLayer, held: (m: GroupMember) => boolean): number | null {
  return groupsOf(layer).find((g) => !g.removed && g.members.some(held))?.id ?? null;
}

/**
 * What checking `group` needs to know, read now: every group reachable from its members (the layer's,
 * else the database's), and each spawn member's map, object type and the group it is already in. A
 * spawn in `moves` counts as in no group, since saving moves it. A database group the layer has
 * changed is known by the layer's copy only. Without a database every database read answers null.
 */
export async function groupContext(
  db: WorldDb | null,
  layer: WorldLayer,
  store: ProjectEntities,
  moves: readonly Move[],
  group?: SpawnGroup,
): Promise<GroupContext> {
  const inLayer = new Map(groupsOf(layer).map((g) => [g.id, g]));
  const groups = new Map(inLayer);

  // Every group below the checked one, read once
  const stack = (group?.members ?? []).flatMap((m) => (m.type === 'group' ? [m.id] : []));
  const visited = new Set<number>(group ? [group.id] : []);
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    let found = groups.get(id) ?? null;
    if (!found && db) {
      found = await readGroup(db, id);
      if (found) groups.set(id, found);
    }
    for (const m of found?.members ?? []) if (m.type === 'group') stack.push(m.id);
  }

  const storeSpawn = (kind: Kind, guid: number) => {
    const owners = kind === 'npc' ? store.npcs : store.objects;
    for (const owner of owners) {
      const spawn = owner.spawns.find((s) => s.guid === guid);
      if (spawn) return { owner, spawn };
    }
    return null;
  };
  const placed = (kind: Kind, guid: number) => layer.added.find((a) => a.kind === spawnTable(kind) && a.guid === guid) ?? null;

  // The database's answers for each spawn and group member, read before the checks run
  const maps = new Map<string, number | null>();
  const types = new Map<number, number | null>();
  const dbSpawnGroup = new Map<string, number | null>();
  const dbMother = new Map<number, number | null>();
  const templateType = async (entry: number): Promise<number | null> => {
    const [row] = await rowsOf(db!, 'gameobject_template', { entry: String(entry) });
    return row ? num(row.type) : null;
  };
  if (db) {
    for (const m of group?.members ?? []) {
      if (m.type === 'group') {
        const [row] = await rowsOf(db, 'pool_pool', { pool_id: String(m.id) });
        dbMother.set(m.id, row ? num(row.mother_pool) : null);
        continue;
      }
      const key = `${m.kind}:${m.guid}`;
      const own = storeSpawn(m.kind, m.guid) !== null || placed(m.kind, m.guid) !== null;
      const read = own ? null : await readPlacement(db, spawnTable(m.kind), m.guid);
      if (!own) maps.set(key, read?.map ?? null);
      if (m.kind === 'object' && storeSpawn('object', m.guid) === null) {
        const entry = placed('object', m.guid)?.entry ?? read?.entry ?? null;
        types.set(m.guid, entry === null ? null : await templateType(entry));
      }
      const [row] = await rowsOf(db, poolTable(m.kind), { guid: String(m.guid) });
      dbSpawnGroup.set(key, row ? num(row.pool_entry) : null);
    }
  }

  return {
    groups,
    spawnMap(kind, guid) {
      const own = storeSpawn(kind, guid);
      if (own) return own.spawn.map;
      const put = placed(kind, guid);
      if (put) return put.map;
      return maps.get(`${kind}:${guid}`) ?? null;
    },
    objectType(guid) {
      const own = storeSpawn('object', guid);
      if (own) return OBJECT_TYPE_VALUE[(own.owner as ProjectEntities['objects'][number]).type];
      return types.get(guid) ?? null;
    },
    groupOfSpawn(kind, guid) {
      if (moves.some((m) => m.kind === kind && m.guid === guid)) return null;
      const held = layerHolder(layer, (m) => m.type === 'spawn' && m.kind === kind && m.guid === guid);
      if (held !== null) return held;
      const pool = dbSpawnGroup.get(`${kind}:${guid}`) ?? null;
      // The layer's copy of that group, without this spawn, wins over the database's
      return pool === null || inLayer.has(pool) ? null : pool;
    },
    groupOfGroup(id) {
      const held = layerHolder(layer, (m) => m.type === 'group' && m.id === id);
      if (held !== null) return held;
      const mother = dbMother.get(id) ?? null;
      return mother === null || inLayer.has(mother) ? null : mother;
    },
  };
}
