import type { SpawnEvents } from '../entities/model';

/**
 * Spawns as the 3D view draws them: where each stands and faces, which display it wears, how big it
 * is, and how it moves (a wander radius, or a patrol route). Read from the world database by
 * `viewSpawns`, and made from the open quest's own NPCs and objects by `ownViewSpawns`.
 */

export interface ViewPoint {
  x: number;
  y: number;
  z: number;
  /**
   * What the point keeps that the 3D view does not edit, carried through edits untouched: a database
   * point's other `waypoint_data` columns, or an own NPC's patrol point (its wait, facing, actions)
   */
  carry?: unknown;
}

/** The game event a spawn belongs to: it is in the world only while the event runs (a holiday, a fishing contest) */
export interface ViewEvent {
  id: number;
  name: string;
}

/** The equipment slots a display preset dresses, in the table's order */
export const PRESET_SLOTS = ['head', 'shoulders', 'body', 'chest', 'waist', 'legs', 'feet', 'wrists', 'hands', 'back', 'tabard'] as const;
export type PresetSlot = (typeof PRESET_SLOTS)[number];

/**
 * How a display preset (`creature_display_preset`, a CoA table) dresses an NPC: a race's body in a
 * player's look, wearing items by slot, as the server sends it to the game
 */
export interface ViewPreset {
  race: number;
  sex: number;
  skin: number;
  face: number;
  hairStyle: number;
  hairColour: number;
  facialHair: number;
  /**
   * Item display ids (ItemDisplayInfo) by slot, not item ids: the server sends them to the game as
   * they are, in the mirror image data; 0 for none
   */
  items: Record<PresetSlot, number>;
}

export interface ViewCreature {
  guid: number;
  entry: number;
  name: string;
  map: number;
  x: number;
  y: number;
  z: number;
  /** Radians about Z */
  orientation: number;
  /** 0 when it has none: drawn as a marker */
  displayId: number;
  scale: number;
  /** Yards it roams from its spawn; 0 when it stands or patrols */
  wander: number;
  /** Its patrol route in order, or null when it has none */
  path: ViewPoint[] | null;
  /** The route's `waypoint_data` id (its own addon's, else its template's); 0 when it has none */
  pathId: number;
  /** Item ids held: main hand, off hand, ranged; 0 for none */
  equipment: [number, number, number];
  /** One of the open project's own (not yet exported) */
  own: boolean;
  /** One placed in the 3D view, kept in the world layer until it is exported */
  added?: boolean;
  /** The first event it appears for (the lowest id), or null when it is always in the world */
  event: ViewEvent | null;
  /** Every event it appears for, by id: it is in the world only while one of them runs */
  events: ViewEvent[];
  /** Every event that takes it away while it runs (a negative `eventEntry`), by id */
  removedBy: ViewEvent[];
  /** The display preset that dresses it, when the database has one for it */
  preset: ViewPreset | null;
  /** The spawn group (pool) it is in, or null when it is in none */
  group: number | null;
  /** Its template's `npcflag` (128 is a vendor), when the query gave it */
  npcFlags?: number;
  /** The top-level group its database group sits in (itself when not nested), when the query gave it */
  poolTop?: number | null;
  /** The event that top-level group follows in the database (game_event_pool), which `events` or `removedBy` holds */
  poolEvent?: PoolEvent | null;
  /** Seconds before it respawns once killed (`spawntimesecs`) */
  respawnSecs: number;
  /** The game events it follows of its own, as the project sets them; absent follows its NPC (or the database) */
  spawnEvents?: SpawnEvents;
}

export interface ViewObject {
  guid: number;
  entry: number;
  name: string;
  map: number;
  x: number;
  y: number;
  z: number;
  /** Quaternion x, y, z, w */
  rotation: [number, number, number, number];
  displayId: number;
  scale: number;
  /** Its template's `type` (3 is a chest), or -1 when it is not known */
  objectType: number;
  own: boolean;
  /** One placed in the 3D view, kept in the world layer until it is exported */
  added?: boolean;
  /** The first event it appears for (the lowest id), or null when it is always in the world */
  event: ViewEvent | null;
  /** Every event it appears for, by id */
  events: ViewEvent[];
  /** Every event that takes it away while it runs, by id */
  removedBy: ViewEvent[];
  /** The spawn group (pool) it is in, or null when it is in none */
  group: number | null;
  /** The top-level group its database group sits in (itself when not nested), when the query gave it */
  poolTop?: number | null;
  /** The event that top-level group follows in the database (game_event_pool), which `events` or `removedBy` holds */
  poolEvent?: PoolEvent | null;
  /** Seconds before it respawns once used up (`spawntimesecs`) */
  respawnSecs: number;
}

/** The event a spawn's top-level group follows in the database */
export interface PoolEvent {
  /** The top-level group whose game_event_pool row it is */
  pool: number;
  id: number;
  /** Brings the spawns (positive), else takes them away */
  during: boolean;
  /** The spawn also has its own event row for this event, which stays when the group's goes */
  alsoOwn: boolean;
}

export interface ViewSpawns {
  creatures: ViewCreature[];
  objects: ViewObject[];
  /** A kind had more than SPAWN_VIEW_CAP in the box, and only the first are given */
  capped: { creatures: boolean; objects: boolean };
}

/** Spawns of each kind given for one area at most */
export const SPAWN_VIEW_CAP = 2000;

/** The respawn time a spawn without one is given, as the game does */
const DEFAULT_RESPAWN_SECS = 300;

/** MovementType 1: roams at random within its wander distance */
const RANDOM_MOVEMENT = '1';

type Row = Readonly<Record<string, string | null>>;

/** A spawn's event from its `event_entry` and `event_name` columns; none when it has no event */
const eventOf = (row: Row): ViewEvent | null => {
  const id = num(row.event_entry);
  return id > 0 ? { id, name: row.event_name ?? '' } : null;
};

/** How `event_list` joins a spawn's event rows: each row's entry and name, split by this */
export const EVENT_FIELD = '\u001e';
/** ... and the rows, split by this (neither appears in a name) */
export const EVENT_ROW = '\u001f';

/**
 * A spawn's events from its `event_list` column (every `game_event_creature` / `_gameobject` row
 * for it): those it appears for, and those that take it away (a negative entry), each by id; with the
 * event its top-level group follows, from its `pool_event_entry` and `pool_event_name` columns
 */
const eventListOf = (row: Row): { events: ViewEvent[]; removedBy: ViewEvent[] } => {
  const events: ViewEvent[] = [];
  const removedBy: ViewEvent[] = [];
  for (const part of (row.event_list ?? '').split(EVENT_ROW)) {
    if (!part) continue;
    const cut = part.indexOf(EVENT_FIELD);
    const entry = num(cut < 0 ? part : part.slice(0, cut));
    const name = cut < 0 ? '' : part.slice(cut + 1);
    if (entry > 0) events.push({ id: entry, name });
    else if (entry < 0) removedBy.push({ id: -entry, name });
  }
  // The event its top-level group follows (game_event_pool) counts as one of its own
  const poolEntry = num(row.pool_event_entry);
  const poolEvent = { id: Math.abs(poolEntry), name: row.pool_event_name ?? '' };
  const into = poolEntry > 0 ? events : poolEntry < 0 ? removedBy : null;
  const alsoOwn = into ? into.some((e) => e.id === poolEvent.id) : false;
  if (into && !alsoOwn) into.push(poolEvent);
  const byId = (a: ViewEvent, b: ViewEvent) => a.id - b.id;
  return { events: events.sort(byId), removedBy: removedBy.sort(byId), ...poolOf(row, alsoOwn) };
};

/** Its database top-level group and that group's event, when the query gave them */
const poolOf = (row: Row, alsoOwn: boolean): { poolTop?: number; poolEvent?: PoolEvent | null } => {
  // Left out for a spawn in no group (or a query without groups)
  if (row.pool_top === undefined || row.pool_top === null || row.pool_top === '') return {};
  const poolTop = num(row.pool_top);
  const entry = num(row.pool_event_entry);
  return { poolTop, poolEvent: entry !== 0 ? { pool: poolTop, id: Math.abs(entry), during: entry > 0, alsoOwn } : null };
};

/** Its first event: its own (`event_entry`), or its top-level group's when that one comes first */
const firstEventOf = (row: Row): ViewEvent | null => {
  const own = eventOf(row);
  const poolEntry = num(row.pool_event_entry);
  if (poolEntry > 0 && (own === null || poolEntry < own.id)) return { id: poolEntry, name: row.pool_event_name ?? '' };
  return own;
};

const num = (value: string | null | undefined, fallback = 0): number => {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/** A spawn's group from its `pool_entry` column; null when it is in none (or the query had no pools) */
const groupOf = (row: Row): number | null => (row.pool_entry === null || row.pool_entry === undefined || row.pool_entry === '' ? null : num(row.pool_entry));

export function toViewCreature(row: Row, path: ViewPoint[] | null, equipment: [number, number, number], preset: ViewPreset | null = null): ViewCreature {
  return {
    guid: num(row.guid),
    entry: num(row.entry),
    name: row.name ?? '',
    map: num(row.map),
    x: num(row.position_x),
    y: num(row.position_y),
    z: num(row.position_z),
    orientation: num(row.orientation),
    displayId: num(row.display_id),
    scale: num(row.display_scale, 1),
    wander: row.MovementType === RANDOM_MOVEMENT ? num(row.wander_distance) : 0,
    path,
    pathId: num(row.path_id),
    equipment,
    own: false,
    event: firstEventOf(row),
    ...eventListOf(row),
    preset,
    group: groupOf(row),
    ...(row.npcflag === null || row.npcflag === undefined ? {} : { npcFlags: num(row.npcflag) }),
    respawnSecs: num(row.spawntimesecs, DEFAULT_RESPAWN_SECS),
  };
}

export function toViewObject(row: Row): ViewObject {
  return {
    guid: num(row.guid),
    entry: num(row.entry),
    name: row.name ?? '',
    map: num(row.map),
    x: num(row.position_x),
    y: num(row.position_y),
    z: num(row.position_z),
    rotation: [num(row.rotation0), num(row.rotation1), num(row.rotation2), num(row.rotation3, 1)],
    displayId: num(row.display_id),
    scale: num(row.size, 1),
    objectType: num(row.type, -1),
    own: false,
    event: firstEventOf(row),
    ...eventListOf(row),
    group: groupOf(row),
    respawnSecs: num(row.spawntimesecs, DEFAULT_RESPAWN_SECS),
  };
}

/** A `creature_display_preset` row as the look it gives */
export function toViewPreset(row: Row): ViewPreset {
  return {
    race: num(row.race),
    sex: num(row.gender),
    skin: num(row.skin),
    face: num(row.face),
    hairStyle: num(row.hair),
    hairColour: num(row.haircolor),
    facialHair: num(row.facialhair),
    items: Object.fromEntries(PRESET_SLOTS.map((slot) => [slot, num(row[`item_${slot}`])])) as Record<PresetSlot, number>,
  };
}

/**
 * The preset the server dresses a creature in: the one for its entry and display, else its entry's
 * first (the lowest display id, as the server's table loads); null when its entry has none
 */
export function pickPreset(rows: readonly Row[], entry: number, displayId: number): ViewPreset | null {
  const mine = rows.filter((r) => num(r.entry) === entry).sort((a, b) => num(a.display_id) - num(b.display_id));
  const chosen = mine.find((r) => num(r.display_id) === displayId) ?? mine[0];
  return chosen ? toViewPreset(chosen) : null;
}

/** The columns of a route row that say which route, which point and where; the rest is carried */
const ROUTE_COLUMNS = new Set(['id', 'guid', 'point', 'position_x', 'position_y', 'position_z']);

/** A patrol's `waypoint_data` rows as points, in `point` order whatever order they came in */
export function orderPath(rows: readonly Row[]): ViewPoint[] {
  return [...rows]
    .sort((a, b) => num(a.point) - num(b.point))
    .map((row) => ({
      x: num(row.position_x),
      y: num(row.position_y),
      z: num(row.position_z),
      carry: Object.fromEntries(Object.entries(row).filter(([column]) => !ROUTE_COLUMNS.has(column))),
    }));
}
