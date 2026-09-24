/** Existing spawns as the quest map shows them: dots in the world, found by map area or by entry. */

export type SpawnKind = 'creature' | 'gameobject';

export interface SpawnDot {
  kind: SpawnKind;
  guid: number;
  entry: number;
  name: string;
  map: number;
  x: number;
  y: number;
  z: number;
}

/** An area of a map in world yards (X north, Y west). */
export interface MapBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Where each kind's spawns and names live: `creature` names its template `id1`, `gameobject` `id`. */
export const SPAWN_TABLES: Record<SpawnKind, { table: string; entry: string; template: string }> = {
  creature: { table: 'creature', entry: 'id1', template: 'creature_template' },
  gameobject: { table: 'gameobject', entry: 'id', template: 'gameobject_template' },
};

/** A spawn row (`guid`, `entry`, `map`, `position_x/y/z`, `name`) as a dot. */
export function toSpawnDot(kind: SpawnKind, row: Readonly<Record<string, string | null>>): SpawnDot {
  const n = (v: string | null | undefined): number => Number(v ?? 0);
  return {
    kind, guid: n(row.guid), entry: n(row.entry), name: row.name ?? '', map: n(row.map),
    x: n(row.position_x), y: n(row.position_y), z: n(row.position_z),
  };
}
