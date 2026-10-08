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
