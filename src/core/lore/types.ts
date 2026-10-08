import type { Compass } from './facing';

/**
 * What the lore queries answer. Plain data, shared by the queries, the API contract and the MCP tools.
 */

/** The kinds of thing whose names and ids can be checked for a clash. */
export type NameKind = 'creature' | 'gameobject' | 'item' | 'quest';

/** A thing that already has this name (or one like it), and where it is. */
export interface NameMatch {
  id: number;
  name: string;
  source: 'database' | 'project';
}

export interface NameCheck {
  name: string;
  /** Same name, ignoring case */
  exact: NameMatch[];
  /** A longer or shorter name that contains the text; at most 5 */
  similar: NameMatch[];
}

export interface IdCheck {
  id: number;
  database: { name: string } | null;
  project: { name: string } | null;
}

/** The names the open project holds of its own, by kind */
export type ProjectNames = Record<NameKind, { id: number; name: string }[]>;

/** A creature or object, by id and name */
export interface NamedRef {
  kind: 'creature' | 'gameobject';
  id: number;
  name: string;
}

export interface ZoneQuest {
  id: number;
  title: string;
  /** -1 for a quest that scales to the player */
  level: number;
  minLevel: number;
  repeatable: 'daily' | 'weekly' | null;
  /** Who starts it: at most 3 */
  starters: NamedRef[];
}

export interface ZoneQuests {
  zone: { id: number; name: string };
  quests: ZoneQuest[];
  /** How many quests matched, before the limit */
  total: number;
  truncated: boolean;
}

/** A quest read without importing it: its text, what it asks for and gives, who starts and ends it, and its place in a chain */
export interface QuestSummary {
  id: number;
  title: string;
  level: number;
  minLevel: number;
  zone: { id: number; name: string } | null;
  repeatable: 'daily' | 'weekly' | null;
  text: { objectives: string; details: string; reward: string; requestItems: string; completion: string };
  objectives: { kind: 'creature' | 'gameobject' | 'item'; id: number; name: string; count: number }[];
  rewards: {
    money: number;
    items: { id: number; name: string; count: number }[];
    choices: { id: number; name: string; count: number }[];
    /** Raw faction ids and values: faction names need Faction.dbc ids this app does not index */
    reputation: { faction: number; value: number }[];
  };
  starters: NamedRef[];
  enders: NamedRef[];
  chain: { previous: number; next: number; exclusiveGroup: number; breadcrumbFor: number };
}

export interface QuestSummaries {
  quests: QuestSummary[];
  /** Ids the database has no quest for */
  missing: number[];
}

/** What an NPC does for a player, from its `npcflag` */
export type Role =
  | 'gossip'
  | 'quest giver'
  | 'trainer'
  | 'vendor'
  | 'repairer'
  | 'flight master'
  | 'innkeeper'
  | 'banker'
  | 'auctioneer'
  | 'stable master'
  | 'battlemaster'
  | 'spirit healer';

/**
 * One spawn near the point asked about, with what is needed to place something beside it. World
 * yards: X north, Y west, Z up. `orientation` is radians, exactly what `add_spawn` takes: 0 faces
 * north and it grows toward west (π/2 west, π south, 3π/2 east).
 */
export interface AreaSpawn {
  guid: number;
  x: number;
  y: number;
  z: number;
  /** x and y relative to the point asked about */
  dx: number;
  dy: number;
  /** Yards from the point asked about, along the ground */
  distance: number;
  orientation: number;
  /** The same orientation as a compass word */
  facing: Compass;
  /** Yards it roams from its spawn; 0 when it stands or patrols */
  wander: number;
  /** The `waypoint_data` path it walks; 0 for none */
  pathId: number;
  respawnSecs: number;
}

export interface AreaObjectSpawn extends Omit<AreaSpawn, 'wander' | 'pathId'> {
  /** The quaternion x, y, z, w the database stores */
  rotation: [number, number, number, number];
}

export interface AreaDrop {
  item: number;
  name: string;
  /** Percent; a group's rows with no chance of their own share what the group has left */
  chance: number;
  group: number;
  /** The reference loot table it comes through, or null when it is the NPC's own row */
  viaReference: number | null;
}

export interface AreaNpc {
  entry: number;
  name: string;
  subname: string;
  level: { min: number; max: number };
  rank: number;
  faction: { template: number; name: string | null };
  roles: Role[];
  /** How many of it stand in the circle; `spawns` lists the nearest */
  spawnCount: number;
  spawns: AreaSpawn[];
  /** Quests it starts and ends (ids) */
  starts: number[];
  ends: number[];
  /** What it sells, in slot order */
  vendor: { item: number; name: string }[];
  drops: AreaDrop[];
}

export interface AreaObject {
  entry: number;
  name: string;
  /** Its template type (3 is a chest, 8 a spellcaster) or -1 when unknown */
  type: number;
  spawnCount: number;
  spawns: AreaObjectSpawn[];
  starts: number[];
  ends: number[];
}

export interface AreaOverview {
  query: { map: number; x: number; y: number; radius: number };
  npcs: AreaNpc[];
  objects: AreaObject[];
  /** The quests these NPCs and objects start and end */
  quests: { id: number; title: string; level: number }[];
  /** The factions of the NPCs found, with how many NPCs each has */
  factions: { template: number; name: string | null; npcs: number }[];
  /** Which lists were cut at their limit; `read` means the box held more spawns than were read, so the nearest may be missing */
  truncated: { npcs: boolean; objects: boolean; quests: boolean; spawns: boolean; vendor: boolean; drops: boolean; read: boolean };
  /** Tables this fork lacks; a section that needs one is empty */
  missing: string[];
}

export interface AreaLimits {
  npcs: number;
  objects: number;
  spawnsPerEntry: number;
  quests: number;
  vendorItems: number;
  drops: number;
  /** Spawns of each kind read from the box before the circle is applied */
  spawnRead: number;
}

/** A search on warcraft.wiki.gg */
export interface WikiSearchResult {
  results: { title: string; snippet: string; url: string }[];
  /** Which era this server is in, for reading the wiki */
  note: string;
  /** How the wiki's text may be reused */
  license: string;
}

/** One wiki page: its intro, its headings, and, when asked, one section */
export interface WikiPageResult {
  title: string;
  url: string;
  redirectedFrom: string | null;
  intro: string;
  sections: { heading: string; level: number }[];
  section: { heading: string; text: string } | null;
  note: string;
  license: string;
}
