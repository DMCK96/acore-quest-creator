import type { RawRow } from '../db/types';
import type { WorldDb } from '../db/world-db';
import { rowsOrNone } from '../links/context';
import { objectMenus } from '../db/object-menus';
import { prefixedRows } from '../scripts/context';
import { questTagPrefix } from '../scripts/tag';
import type { ProjectEntities } from './model';

/** The tables new NPCs, objects and items are written to. */
export const ENTITY_TABLES = [
  'creature_template', 'creature_template_model', 'creature', 'gameobject_template', 'gameobject', 'page_text',
  'creature_loot_template', 'gameobject_loot_template', 'creature_addon', 'waypoint_data', 'creature_equip_template',
  'item_template', 'npc_vendor', 'creature_default_trainer', 'trainer', 'trainer_spell',
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
  creature_equip_template: ['CreatureID', 'ID'],
  item_template: ['entry'],
  npc_vendor: ['entry', 'item', 'ExtendedCost'],
  gossip_menu: ['MenuID', 'TextID'],
  gossip_menu_option: ['MenuID', 'OptionID'],
  npc_text: ['ID'],
  creature_default_trainer: ['CreatureId'],
  trainer: ['Id'],
  trainer_spell: ['TrainerId', 'SpellId'],
};

/**
 * What the database holds now for a quest's new entities: the template rows (so what quest
 * scripting set on them survives a re-insert) and the spawns this quest placed before (so removed
 * spawns are deleted).
 */
export interface EntityContext {
  /** `creature_template` rows of the new NPCs' entries: entry, AIName, gossip_menu_id, npcflag, flags_extra, type_flags. */
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
  /** `creature_default_trainer` rows (CreatureId, TrainerId) of the new NPCs' entries: the trainers a past export pointed them at. */
  trainerIds: RawRow[];
  /** Every `creature_default_trainer` row (CreatureId, TrainerId) that names one of those trainers: who else uses them. */
  trainerUsers: RawRow[];
  /** `gossip_menu_option` rows (MenuID, OptionID, ActionMenuID) of the menus the new NPCs hold or point at, and of the menus those open. */
  gossipOptions: RawRow[];
  /** Every option (MenuID, ActionMenuID) that opens one of those menus: who else leads there. */
  gossipOpeners: RawRow[];
  /** `gossip_menu` rows (MenuID, TextID) of those menus. */
  gossipMenus: RawRow[];
  /** Who uses those menus: a creature by entry, or an object as Entry '-1' (never a project NPC). */
  gossipUsers: RawRow[];
  /** The gossip-select scripts (event_param1 the menu, event_param2 the option) that name those menus: options scenes own. */
  gossipScripted: RawRow[];
}

export const EMPTY_ENTITY_CONTEXT: EntityContext = {
  creatures: [],
  gameobjects: [],
  taggedCreatureSpawns: [],
  taggedObjectSpawns: [],
  taggedLoot: { creature: [], gameobject: [] },
  addons: [],
  waypointRows: [],
  trainerIds: [],
  trainerUsers: [],
  gossipOptions: [],
  gossipOpeners: [],
  gossipMenus: [],
  gossipUsers: [],
  gossipScripted: [],
};

/**
 * Reads what the database holds for the project's entities. Spawns and loot a past export wrote are
 * found by the entity tags, and by the quest tags of `legacyQuestIds` that exports before version 4 wrote.
 */
export async function readEntityContext(db: WorldDb, entities: ProjectEntities, legacyQuestIds: readonly number[]): Promise<EntityContext> {
  const npcEntries = entities.npcs.map((n) => String(n.entry));
  const objectEntries = entities.objects.map((o) => String(o.entry));
  const tagged = async (table: string, prefixes: readonly string[]): Promise<RawRow[]> => {
    const found = await Promise.all(prefixes.map((p) => prefixedRows(db, table, 'Comment', p)));
    const seen = new Set<string>();
    return found.flat().filter((row) => {
      const key = JSON.stringify(row);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const legacy = legacyQuestIds.map(questTagPrefix);
  const [creatures, gameobjects, taggedCreatureSpawns, taggedObjectSpawns, creatureLoot, objectLoot] = await Promise.all([
    rowsOrNone(db, 'creature_template', { entry: npcEntries }),
    rowsOrNone(db, 'gameobject_template', { entry: objectEntries }),
    tagged('creature', ['AQC npc', ...legacy]),
    tagged('gameobject', ['AQC obj', ...legacy]),
    tagged('creature_loot_template', ['AQC npc', ...legacy]),
    tagged('gameobject_loot_template', ['AQC obj', ...legacy]),
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
  const trainerIds = await rowsOrNone(db, 'creature_default_trainer', { CreatureId: npcEntries });
  const trainerUsers = trainerIds.length > 0 ? await rowsOrNone(db, 'creature_default_trainer', { TrainerId: [...new Set(trainerIds.map((r) => r.TrainerId ?? ''))] }) : [];
  // The menus the new NPCs hold, or their templates point at: what a past export wrote there, and who else uses them
  const menuSet = new Set([
    ...entities.npcs.flatMap((n) => (n.gossipMenu ? n.gossipMenu.menus.map((m) => String(m.menuId)) : [])),
    ...creatures.map((r) => r.gossip_menu_id ?? '0').filter((id) => id !== '0'),
  ]);
  // The menus those open are theirs to clean up too: followed through the options, to the depth an NPC's tree can have
  const gossipOptions: RawRow[] = [];
  for (let frontier = [...menuSet], depth = 0; frontier.length > 0 && depth < 24; depth++) {
    const rows = await rowsOrNone(db, 'gossip_menu_option', { MenuID: frontier });
    gossipOptions.push(...rows);
    frontier = [...new Set(rows.map((r) => r.ActionMenuID ?? '0'))].filter((id) => id !== '0' && !menuSet.has(id));
    for (const id of frontier) menuSet.add(id);
  }
  const menuIds = [...menuSet];
  const [gossipMenus, menuCreatures, menuObjects, gossipScripted, gossipOpeners] = menuIds.length > 0
    ? await Promise.all([
      rowsOrNone(db, 'gossip_menu', { MenuID: menuIds }),
      rowsOrNone(db, 'creature_template', { gossip_menu_id: menuIds }),
      objectMenus(db, menuIds),
      rowsOrNone(db, 'smart_scripts', { source_type: '0', event_type: '62', event_param1: menuIds }),
      rowsOrNone(db, 'gossip_menu_option', { ActionMenuID: menuIds }),
    ])
    : [[], [], [], [], []];
  const gossipUsers = [
    ...menuCreatures.map((r) => ({ MenuID: r.gossip_menu_id ?? '0', Entry: r.entry ?? '0' })),
    ...menuObjects.map((menu) => ({ MenuID: String(menu), Entry: '-1' })),
  ];
  return {
    creatures: pick(creatures, ['entry', 'AIName', 'gossip_menu_id', 'npcflag', 'flags_extra', 'type_flags']),
    gameobjects: pick(gameobjects, ['entry', 'AIName']),
    taggedCreatureSpawns: pick(taggedCreatureSpawns, ['guid', 'Comment']),
    taggedObjectSpawns: pick(taggedObjectSpawns, ['guid', 'Comment']),
    taggedLoot: { creature: pick(creatureLoot, ['Entry', 'Item', 'Comment']), gameobject: pick(objectLoot, ['Entry', 'Item', 'Comment']) },
    addons: pick(addons, ['guid', 'path_id']),
    waypointRows: pick(waypointRows, ['id', 'point']),
    trainerIds: pick(trainerIds, ['CreatureId', 'TrainerId']),
    trainerUsers: pick(trainerUsers, ['CreatureId', 'TrainerId']),
    gossipOptions: pick(gossipOptions, ['MenuID', 'OptionID', 'ActionMenuID']),
    gossipOpeners: pick(gossipOpeners, ['MenuID', 'ActionMenuID']),
    gossipMenus: pick(gossipMenus, ['MenuID', 'TextID']),
    gossipUsers,
    gossipScripted: pick(gossipScripted, ['event_param1', 'event_param2']),
  };
}
