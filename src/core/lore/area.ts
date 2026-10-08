import { rowsOrNone } from '../db/rows-or-none';
import type { RawRow } from '../db/types';
import type { WorldDb } from '../db/world-db';
import type { ViewCreature, ViewObject } from '../db/view-spawns';
import { compassOf, normaliseOrientation } from './facing';
import type { AreaLimits, AreaNpc, AreaObject, AreaObjectSpawn, AreaOverview, AreaSpawn, Role } from './types';

export const AREA_LIMITS: AreaLimits = { npcs: 40, objects: 20, spawnsPerEntry: 8, quests: 30, vendorItems: 20, drops: 12 };

/** More than any real point holds; the circle and the entry limits do the cutting. */
const SPAWN_READ_LIMIT = 5000;

/** Tables the overview reads that a fork may lack; a missing one empties its section and is reported. */
export const AREA_TABLES = [
  'creature_queststarter',
  'creature_questender',
  'gameobject_queststarter',
  'gameobject_questender',
  'npc_vendor',
  'creature_loot_template',
  'reference_loot_template',
] as const;

/** `npcflag` bits, in the order the roles are listed. */
const ROLE_BITS: readonly [Role, number][] = [
  ['gossip', 1],
  ['quest giver', 2],
  ['trainer', 16 | 32 | 64],
  ['vendor', 128 | 256 | 512 | 1024 | 2048],
  ['repairer', 4096],
  ['flight master', 8192],
  ['spirit healer', 16384 | 32768],
  ['innkeeper', 65536],
  ['banker', 131072],
  ['battlemaster', 1048576],
  ['auctioneer', 2097152],
  ['stable master', 4194304],
];

export const rolesOf = (npcflag: number): Role[] => ROLE_BITS.filter(([, bits]) => (npcflag & bits) !== 0).map(([role]) => role);

const num = (row: RawRow | undefined, column: string): number => Number(row?.[column] ?? 0) || 0;
const round = (value: number, places: number): number => Math.round(value * 10 ** places) / 10 ** places || 0;

/** The turn about Z (radians, 0 up to 2π) of an object's quaternion x, y, z, w: which way it faces. */
function yawOf([x, y, z, w]: [number, number, number, number]): number {
  return normaliseOrientation(Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)));
}

interface Placed<T> {
  spawn: T;
  distance: number;
}

/** Keeps the spawns inside the circle, nearest first (ties by guid). */
function inCircle<T extends { x: number; y: number; guid: number }>(spawns: T[], query: { x: number; y: number; radius: number }): Placed<T>[] {
  return spawns
    .map((spawn) => ({ spawn, distance: Math.hypot(spawn.x - query.x, spawn.y - query.y) }))
    .filter((p) => p.distance <= query.radius)
    .sort((a, b) => a.distance - b.distance || a.spawn.guid - b.spawn.guid);
}

/** Groups placed spawns by entry, the groups ordered by their nearest spawn (ties by entry). */
function byEntry<T extends { entry: number }>(placed: Placed<T>[]): Placed<T>[][] {
  const groups = new Map<number, Placed<T>[]>();
  for (const p of placed) groups.set(p.spawn.entry, [...(groups.get(p.spawn.entry) ?? []), p]);
  return [...groups.entries()].sort(([ea, a], [eb, b]) => a[0]!.distance - b[0]!.distance || ea - eb).map(([, g]) => g);
}

const spawnOf = (p: Placed<ViewCreature | ViewObject>, query: { x: number; y: number }) => ({
  guid: p.spawn.guid,
  x: p.spawn.x,
  y: p.spawn.y,
  z: p.spawn.z,
  dx: round(p.spawn.x - query.x, 1),
  dy: round(p.spawn.y - query.y, 1),
  distance: round(p.distance, 1),
  respawnSecs: p.spawn.respawnSecs,
});

/** Quest ids by giver id, ascending, from one quest-giver table. */
async function questsByGiver(db: WorldDb, table: string, ids: number[]): Promise<Map<number, number[]>> {
  const rows = ids.length === 0 ? [] : await rowsOrNone(db, table, { id: ids.map(String) });
  const out = new Map<number, number[]>();
  for (const r of rows) out.set(num(r, 'id'), [...(out.get(num(r, 'id')) ?? []), num(r, 'quest')]);
  for (const [id, quests] of out) out.set(id, [...new Set(quests)].sort((a, b) => a - b));
  return out;
}

/**
 * What stands around a point on a map: the NPCs and objects inside the circle, each with where it
 * is and which way it faces, the quests they offer, and the factions the NPCs belong to. Everything
 * is limited to what is in the circle, so the answer stays small.
 */
export async function areaOverview(
  db: WorldDb,
  query: { map: number; x: number; y: number; radius: number },
  names: { faction(template: number): string | undefined },
  limits: Partial<AreaLimits> = {},
): Promise<AreaOverview> {
  if (!db.spawnsForView) throw new Error('This database connection cannot list spawns.');
  const lim: AreaLimits = { ...AREA_LIMITS, ...limits };
  const box = { minX: query.x - query.radius, maxX: query.x + query.radius, minY: query.y - query.radius, maxY: query.y + query.radius };
  const found = await db.spawnsForView(query.map, box, SPAWN_READ_LIMIT);

  const missing: string[] = [];
  for (const table of AREA_TABLES) if ((await db.columns(table)).length === 0) missing.push(table);

  const truncated = { npcs: false, objects: false, quests: false, spawns: false, vendor: false, drops: false };

  const creatureGroups = byEntry(inCircle(found.creatures, query));
  truncated.npcs = creatureGroups.length > lim.npcs;
  const npcGroups = creatureGroups.slice(0, lim.npcs);
  const objectGroups = byEntry(inCircle(found.objects, query));
  truncated.objects = objectGroups.length > lim.objects;
  const shownObjects = objectGroups.slice(0, lim.objects);

  const npcEntries = npcGroups.map((g) => g[0]!.spawn.entry);
  const objectEntries = shownObjects.map((g) => g[0]!.spawn.entry);
  const templates = new Map(
    (npcEntries.length === 0 ? [] : await rowsOrNone(db, 'creature_template', { entry: npcEntries.map(String) })).map((r) => [num(r, 'entry'), r]),
  );
  const [creatureStarts, creatureEnds, objectStarts, objectEnds] = await Promise.all([
    questsByGiver(db, 'creature_queststarter', npcEntries),
    questsByGiver(db, 'creature_questender', npcEntries),
    questsByGiver(db, 'gameobject_queststarter', objectEntries),
    questsByGiver(db, 'gameobject_questender', objectEntries),
  ]);

  const npcs: AreaNpc[] = npcGroups.map((group) => {
    const first = group[0]!.spawn as ViewCreature;
    const t = templates.get(first.entry);
    const template = num(t, 'faction');
    const listed = group.slice(0, lim.spawnsPerEntry);
    if (group.length > listed.length) truncated.spawns = true;
    return {
      entry: first.entry,
      name: first.name || (t?.name ?? ''),
      subname: t?.subname ?? '',
      level: { min: num(t, 'minlevel'), max: num(t, 'maxlevel') },
      rank: num(t, 'rank'),
      faction: { template, name: names.faction(template) ?? null },
      roles: rolesOf(num(t, 'npcflag')),
      spawnCount: group.length,
      spawns: listed.map((p): AreaSpawn => {
        const c = p.spawn as ViewCreature;
        return { ...spawnOf(p, query), orientation: round(c.orientation, 4), facing: compassOf(c.orientation), wander: c.wander, pathId: c.pathId };
      }),
      starts: creatureStarts.get(first.entry) ?? [],
      ends: creatureEnds.get(first.entry) ?? [],
      vendor: [],
      drops: [],
    };
  });

  const objects: AreaObject[] = shownObjects.map((group) => {
    const first = group[0]!.spawn as ViewObject;
    const listed = group.slice(0, lim.spawnsPerEntry);
    if (group.length > listed.length) truncated.spawns = true;
    return {
      entry: first.entry,
      name: first.name,
      type: first.objectType,
      spawnCount: group.length,
      spawns: listed.map((p): AreaObjectSpawn => {
        const o = p.spawn as ViewObject;
        const yaw = yawOf(o.rotation);
        return { ...spawnOf(p, query), orientation: round(yaw, 4), facing: compassOf(yaw), rotation: o.rotation };
      }),
      starts: objectStarts.get(first.entry) ?? [],
      ends: objectEnds.get(first.entry) ?? [],
    };
  });

  const questIds = [
    ...new Set([...[...creatureStarts.values()].flat(), ...[...creatureEnds.values()].flat(), ...[...objectStarts.values()].flat(), ...[...objectEnds.values()].flat()]),
  ];
  const questRows = questIds.length === 0 ? [] : await rowsOrNone(db, 'quest_template', { ID: questIds.map(String) });
  const allQuests = questRows
    .map((r) => ({ id: num(r, 'ID'), title: r.LogTitle ?? '', level: num(r, 'QuestLevel') }))
    .sort((a, b) => a.level - b.level || a.id - b.id);
  truncated.quests = allQuests.length > lim.quests;

  const factionCounts = new Map<number, number>();
  for (const npc of npcs) factionCounts.set(npc.faction.template, (factionCounts.get(npc.faction.template) ?? 0) + 1);
  const factions = [...factionCounts.entries()]
    .sort(([ta, a], [tb, b]) => b - a || ta - tb)
    .map(([template, count]) => ({ template, name: names.faction(template) ?? null, npcs: count }));

  return { query, npcs, objects, quests: allQuests.slice(0, lim.quests), factions, truncated, missing };
}
