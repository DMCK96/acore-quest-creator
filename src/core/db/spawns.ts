/** Existing spawns as the 3D view shows them: dots in the world, found by map area or by entry. */

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
  /** The game event it appears only during (a positive `eventEntry`); absent when it has none or the database has no event tables */
  event?: { id: number; name: string };
}

/** An area of a map in world yards (X north, Y west). */
export interface MapBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Where each kind's spawns and names live. A creature spawn names its NPC `id1` in stock AzerothCore
 * and `id` in older forks (the CoA repack among them): the first of `entry` the table has is used.
 */
export const SPAWN_TABLES: Record<SpawnKind, { table: string; entry: readonly string[]; template: string }> = {
  creature: { table: 'creature', entry: ['id1', 'id'], template: 'creature_template' },
  gameobject: { table: 'gameobject', entry: ['id'], template: 'gameobject_template' },
};

/** The column a spawn table names its template by, of the ones it has. */
export function spawnEntryColumn(kind: SpawnKind, columns: readonly string[]): string {
  const spec = SPAWN_TABLES[kind];
  return spec.entry.find((c) => columns.includes(c)) ?? spec.entry[0]!;
}

/** A spawn row (`guid`, `entry`, `map`, `position_x/y/z`, `name`) as a dot. */
export function toSpawnDot(kind: SpawnKind, row: Readonly<Record<string, string | null>>): SpawnDot {
  const n = (v: string | null | undefined): number => Number(v ?? 0);
  return {
    kind, guid: n(row.guid), entry: n(row.entry), name: row.name ?? '', map: n(row.map),
    x: n(row.position_x), y: n(row.position_y), z: n(row.position_z),
    ...(n(row.event_entry) > 0 ? { event: { id: n(row.event_entry), name: row.event_name ?? '' } } : {}),
  };
}
