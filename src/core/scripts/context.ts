import type { RawRow, Where } from '../db/types';
import { UnknownColumnError, UnknownTableError, type WorldDb } from '../db/world-db';
import { rowsOrNone } from '../links/context';
import { EVENT, SOURCE } from '../smartai/ids';
import type { QuestScene } from './model';
import { questTagPrefix, sceneFromComment } from './tag';

/** Every table quest scripting reads or writes, loaded into the schema at connect. */
export const SCRIPT_TABLES = [
  'smart_scripts',
  'creature_text',
  'conditions',
  'waypoints',
  'gossip_menu',
  'gossip_menu_option',
  'npc_text',
  'areatrigger',
  'areatrigger_scripts',
  'creature_template',
  'gameobject_template',
] as const;

/** Primary keys of the tables above, for comparing and applying script rows in memory. */
export const SCRIPT_KEYS: Record<string, readonly string[]> = {
  smart_scripts: ['entryorguid', 'source_type', 'id', 'link'],
  creature_text: ['CreatureID', 'GroupID', 'ID'],
  conditions: [
    'SourceTypeOrReferenceId', 'SourceGroup', 'SourceEntry', 'SourceId', 'ElseGroup',
    'ConditionTypeOrReference', 'ConditionTarget', 'ConditionValue1', 'ConditionValue2', 'ConditionValue3',
  ],
  waypoints: ['entry', 'pointid'],
  gossip_menu: ['MenuID', 'TextID'],
  gossip_menu_option: ['MenuID', 'OptionID'],
  npc_text: ['ID'],
  areatrigger: ['entry'],
  areatrigger_scripts: ['entry'],
  creature_template: ['entry'],
  gameobject_template: ['entry'],
};

/**
 * The rows already in the world DB that a quest's scenes are compiled against: what sits on each
 * owner (so new rows go around it), the rows this quest wrote before (so they can be replaced), and
 * the highest IDs of the tables that hand out global numbers. Read fresh at every export.
 */
export interface ScriptContext {
  /** Rows on the scenes' owners, source-9 rows in their list ranges, and rows tagged for the quest. */
  smartScripts: RawRow[];
  /** Rows of creature owners, and rows tagged for the quest. */
  creatureText: RawRow[];
  /** Rows tagged for the quest. */
  conditions: RawRow[];
  /** Rows tagged for the quest. */
  waypoints: RawRow[];
  /** Highest `waypoints.entry` in the DB; 0 when empty or absent. */
  waypointsMax: number;
  /** Options on every menu of a creature owner, and on menus the quest's tagged rows name. */
  gossipOptions: RawRow[];
  gossipMenuMax: number;
  npcTextMax: number;
  areatriggerMax: number;
  /** `areatrigger` rows whose entry a tagged area scene used. */
  areatriggers: RawRow[];
  /** `areatrigger_scripts` rows for area-trigger owners and tagged area scenes. */
  areatriggerScripts: RawRow[];
  /** `creature_template` rows of creature owners: entry, npcflag, gossip_menu_id, AIName, ScriptName. */
  creatures: RawRow[];
  /** `gameobject_template` rows of object owners: entry, AIName, ScriptName. */
  gameobjects: RawRow[];
}

export const EMPTY_SCRIPT_CONTEXT: ScriptContext = {
  smartScripts: [],
  creatureText: [],
  conditions: [],
  waypoints: [],
  waypointsMax: 0,
  gossipOptions: [],
  gossipMenuMax: 0,
  npcTextMax: 0,
  areatriggerMax: 0,
  areatriggers: [],
  areatriggerScripts: [],
  creatures: [],
  gameobjects: [],
};

const LIST_SLOTS = 100;

const numberOf = (raw: string | null | undefined): number => {
  if (raw === null || raw === undefined) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
};

/** Rows the tool tagged for this quest; a fork without the table, column or query has none. */
export async function taggedRows(db: WorldDb, table: string, column: string, questId: number): Promise<RawRow[]> {
  if (!db.selectByPrefix) return [];
  try {
    return await db.selectByPrefix(table, column, questTagPrefix(questId));
  } catch (error) {
    if (error instanceof UnknownTableError || error instanceof UnknownColumnError) return [];
    throw error;
  }
}

async function maxOf(db: WorldDb, table: string, column: string): Promise<number> {
  if (!db.selectMax) return 0;
  try {
    return (await db.selectMax(table, column)) ?? 0;
  } catch (error) {
    if (error instanceof UnknownTableError || error instanceof UnknownColumnError) return 0;
    throw error;
  }
}

const rows = (db: WorldDb, table: string, where: Where): Promise<RawRow[]> => rowsOrNone(db, table, where);

/** Keeps the first row of each primary key, so a row read by two queries counts once. */
function unique(table: string, list: readonly RawRow[]): RawRow[] {
  const key = SCRIPT_KEYS[table] ?? [];
  const seen = new Set<string>();
  return list.filter((row) => {
    const text = JSON.stringify(key.map((c) => row[c]));
    if (seen.has(text)) return false;
    seen.add(text);
    return true;
  });
}

/** Timed action list ids that belong to an entry by the wiki's `entry × 100 + n` convention. */
export function listIdsOf(entries: Iterable<number>): string[] {
  const out: string[] = [];
  for (const entry of entries) for (let slot = 0; slot < LIST_SLOTS; slot += 1) out.push(String(entry * LIST_SLOTS + slot));
  return out;
}

/**
 * Everything `compileScenes` needs to know about the world around a quest's scenes, read in a few
 * batched queries: the rows the quest wrote before (by tag, wherever they are), everything else on
 * the owners those rows and the current scenes use, and the highest global numbers in use.
 */
export async function readScriptContext(
  db: WorldDb,
  questId: number,
  scenes: readonly QuestScene[],
  /** Creatures with a fight (slice I): their rows, lists and text are read as a scene owner's are. */
  extraCreatures: readonly number[] = [],
): Promise<ScriptContext> {
  const [taggedSmart, taggedText, taggedConditions, taggedWaypoints] = await Promise.all([
    taggedRows(db, 'smart_scripts', 'comment', questId),
    taggedRows(db, 'creature_text', 'comment', questId),
    taggedRows(db, 'conditions', 'Comment', questId),
    taggedRows(db, 'waypoints', 'point_comment', questId),
  ]);

  const creatures = new Set<number>(extraCreatures.filter((e) => e > 0));
  const gameobjects = new Set<number>();
  const areas = new Set<number>();
  for (const scene of scenes) {
    const owner = scene.owner;
    if (owner.kind === 'creature' && owner.entry > 0) creatures.add(owner.entry);
    else if (owner.kind === 'gameobject' && owner.entry > 0) gameobjects.add(owner.entry);
    else if (owner.kind === 'areatrigger' && owner.id > 0 && !owner.area) areas.add(owner.id);
  }
  const taggedAreas = new Set<number>();
  const taggedMenus = new Set<number>();
  for (const row of taggedSmart) {
    const source = numberOf(row.source_type);
    const entry = numberOf(row.entryorguid);
    if (source === SOURCE.creature && entry > 0) creatures.add(entry);
    else if (source === SOURCE.gameobject && entry > 0) gameobjects.add(entry);
    else if (source === SOURCE.areatrigger) {
      areas.add(entry);
      if (numberOf(row.event_type) !== EVENT.link && sceneFromComment(row.comment)?.owner.kind === 'areatrigger') taggedAreas.add(entry);
    }
    if (numberOf(row.event_type) === EVENT.gossipSelect) taggedMenus.add(numberOf(row.event_param1));
  }

  const ids = (set: ReadonlySet<number>): string[] => [...set].sort((a, b) => a - b).map(String);
  const [onCreatures, onObjects, onAreas, onLists, creatureText, creatureRows, objectRows, areaScripts, areaRows] = await Promise.all([
    rows(db, 'smart_scripts', { source_type: String(SOURCE.creature), entryorguid: ids(creatures) }),
    rows(db, 'smart_scripts', { source_type: String(SOURCE.gameobject), entryorguid: ids(gameobjects) }),
    rows(db, 'smart_scripts', { source_type: String(SOURCE.areatrigger), entryorguid: ids(areas) }),
    rows(db, 'smart_scripts', { source_type: String(SOURCE.timedList), entryorguid: listIdsOf([...creatures, ...gameobjects]) }),
    rows(db, 'creature_text', { CreatureID: ids(creatures) }),
    rows(db, 'creature_template', { entry: ids(creatures) }),
    rows(db, 'gameobject_template', { entry: ids(gameobjects) }),
    rows(db, 'areatrigger_scripts', { entry: ids(areas) }),
    rows(db, 'areatrigger', { entry: ids(taggedAreas) }),
  ]);

  const menus = new Set<number>(taggedMenus);
  for (const row of creatureRows) if (numberOf(row.gossip_menu_id) > 0) menus.add(numberOf(row.gossip_menu_id));
  const [gossipOptions, gossipMenuMax, npcTextMax, waypointsMax, areatriggerMax] = await Promise.all([
    rows(db, 'gossip_menu_option', { MenuID: ids(menus) }),
    maxOf(db, 'gossip_menu', 'MenuID'),
    maxOf(db, 'npc_text', 'ID'),
    maxOf(db, 'waypoints', 'entry'),
    maxOf(db, 'areatrigger', 'entry'),
  ]);

  const pick = (list: readonly RawRow[], columns: readonly string[]): RawRow[] =>
    list.map((row) => Object.fromEntries(columns.map((c) => [c, row[c] ?? null])));

  return {
    smartScripts: unique('smart_scripts', [...taggedSmart, ...onCreatures, ...onObjects, ...onAreas, ...onLists]),
    creatureText: unique('creature_text', [...taggedText, ...creatureText]),
    conditions: unique('conditions', taggedConditions),
    waypoints: unique('waypoints', taggedWaypoints),
    waypointsMax,
    gossipOptions,
    gossipMenuMax,
    npcTextMax,
    areatriggerMax,
    areatriggers: areaRows,
    areatriggerScripts: areaScripts,
    creatures: pick(creatureRows, ['entry', 'npcflag', 'gossip_menu_id', 'AIName', 'ScriptName']),
    gameobjects: pick(objectRows, ['entry', 'AIName', 'ScriptName']),
  };
}
