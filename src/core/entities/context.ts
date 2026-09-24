import type { RawRow } from '../db/types';
import type { WorldDb } from '../db/world-db';
import { rowsOrNone } from '../links/context';
import { taggedRows } from '../scripts/context';
import type { QuestEntities } from './model';

/** The tables new NPCs and objects are written to. */
export const ENTITY_TABLES = [
  'creature_template', 'creature_template_model', 'creature', 'gameobject_template', 'gameobject', 'page_text',
  'creature_loot_template', 'gameobject_loot_template', 'creature_addon', 'waypoint_data',
] as const;

export const ENTITY_KEYS: Record<string, readonly string[]> = {
  creature_template: ['entry'],
  creature_template_model: ['CreatureID', 'Idx'],
  creature: ['guid'],
  gameobject_template: ['entry'],
  gameobject: ['guid'],
  page_text: ['ID'],
  creature_loot_template: ['Entry', 'Item'],
  gameobject_loot_template: ['Entry', 'Item'],
  creature_addon: ['guid'],
  waypoint_data: ['id', 'point'],
};

/**
 * What the database holds now for a quest's new entities: the template rows (so what quest
 * scripting set on them survives a re-insert) and the spawns this quest placed before (so removed
 * spawns are deleted).
 */
export interface EntityContext {
  /** `creature_template` rows of the new NPCs' entries: entry, AIName, gossip_menu_id, npcflag. */
  creatures: RawRow[];
  /** `gameobject_template` rows of the new objects' entries: entry, AIName. */
  gameobjects: RawRow[];
  taggedCreatureSpawns: RawRow[];
  taggedObjectSpawns: RawRow[];
  /** Loot rows this quest wrote before, found by their comment tag. */
  taggedLoot: { creature: RawRow[]; gameobject: RawRow[] };
  /** `creature_addon` rows (guid, path_id) of the project's spawns and the spawns this quest placed before. */
  addons: RawRow[];
  /** `waypoint_data` rows (id, point) of those spawns' routes. */
  waypointRows: RawRow[];
}

export const EMPTY_ENTITY_CONTEXT: EntityContext = {
  creatures: [],
  gameobjects: [],
  taggedCreatureSpawns: [],
  taggedObjectSpawns: [],
  taggedLoot: { creature: [], gameobject: [] },
  addons: [],
  waypointRows: [],
};

export async function readEntityContext(db: WorldDb, questId: number, entities: QuestEntities): Promise<EntityContext> {
  const npcEntries = entities.npcs.map((n) => String(n.entry));
  const objectEntries = entities.objects.map((o) => String(o.entry));
  const [creatures, gameobjects, taggedCreatureSpawns, taggedObjectSpawns, creatureLoot, objectLoot] = await Promise.all([
    rowsOrNone(db, 'creature_template', { entry: npcEntries }),
    rowsOrNone(db, 'gameobject_template', { entry: objectEntries }),
    taggedRows(db, 'creature', 'Comment', questId),
    taggedRows(db, 'gameobject', 'Comment', questId),
    taggedRows(db, 'creature_loot_template', 'Comment', questId),
    taggedRows(db, 'gameobject_loot_template', 'Comment', questId),
  ]);
  const pick = (rows: readonly RawRow[], columns: readonly string[]): RawRow[] =>
    rows.map((row) => Object.fromEntries(columns.map((c) => [c, row[c] ?? null])));
  // Patrol routes: the addon of every spawn this quest has or had, then the routes they and the project name.
  const guids = [...new Set([...entities.npcs.flatMap((n) => n.spawns.map((s) => String(s.guid))), ...taggedCreatureSpawns.map((r) => String(r.guid))])];
  const addons = await rowsOrNone(db, 'creature_addon', { guid: guids });
  const pathIds = new Set<string>();
  for (const npc of entities.npcs) for (const spawn of npc.spawns) if (spawn.patrol && spawn.patrol.pathId > 0) pathIds.add(String(spawn.patrol.pathId));
  for (const row of addons) if (Number(row.path_id) > 0) pathIds.add(String(row.path_id));
  const waypointRows = await rowsOrNone(db, 'waypoint_data', { id: [...pathIds] });
  return {
    creatures: pick(creatures, ['entry', 'AIName', 'gossip_menu_id', 'npcflag']),
    gameobjects: pick(gameobjects, ['entry', 'AIName']),
    taggedCreatureSpawns: pick(taggedCreatureSpawns, ['guid', 'Comment']),
    taggedObjectSpawns: pick(taggedObjectSpawns, ['guid', 'Comment']),
    taggedLoot: { creature: pick(creatureLoot, ['Entry', 'Item', 'Comment']), gameobject: pick(objectLoot, ['Entry', 'Item', 'Comment']) },
    addons: pick(addons, ['guid', 'path_id']),
    waypointRows: pick(waypointRows, ['id', 'point']),
  };
}
