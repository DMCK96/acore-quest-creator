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
