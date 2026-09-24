import type { RawRow } from '../db/types';

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
