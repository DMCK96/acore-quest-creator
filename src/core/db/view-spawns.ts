/**
 * Spawns as the 3D view draws them: where each stands and faces, which display it wears, how big it
 * is, and how it moves (a wander radius, or a patrol route). Read from the world database by
 * `viewSpawns`, and made from the open quest's own NPCs and objects by `ownViewSpawns`.
 */

export interface ViewPoint {
  x: number;
  y: number;
  z: number;
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
  /** Item ids held: main hand, off hand, ranged; 0 for none */
  equipment: [number, number, number];
  /** One of the open project's own (not yet exported) */
  own: boolean;
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
  own: boolean;
}

export interface ViewSpawns {
  creatures: ViewCreature[];
  objects: ViewObject[];
  /** A kind had more than SPAWN_VIEW_CAP in the box, and only the first are given */
  capped: { creatures: boolean; objects: boolean };
}

/** Spawns of each kind given for one area at most */
export const SPAWN_VIEW_CAP = 2000;

/** MovementType 1: roams at random within its wander distance */
const RANDOM_MOVEMENT = '1';

type Row = Readonly<Record<string, string | null>>;

const num = (value: string | null | undefined, fallback = 0): number => {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export function toViewCreature(row: Row, path: ViewPoint[] | null, equipment: [number, number, number]): ViewCreature {
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
    equipment,
    own: false,
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
    own: false,
  };
}

/** A patrol's `waypoint_data` rows as points, in `point` order whatever order they came in */
export function orderPath(rows: readonly Row[]): ViewPoint[] {
  return [...rows]
    .sort((a, b) => num(a.point) - num(b.point))
    .map((row) => ({ x: num(row.position_x), y: num(row.position_y), z: num(row.position_z) }));
}
