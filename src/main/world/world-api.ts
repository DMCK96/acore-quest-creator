import type { RawRow, SchemaInfo } from '../../core/db/types';
import type { WorldDb } from '../../core/db/world-db';
import { spawnEntryColumn } from '../../core/db/spawns';
import type { Placement, RoutePoint, WorldRouteEdit, WorldSpawnEdit, WorldSpawnKind } from '../../core/world/layer';

/**
 * What the world layer reads from the world database: a spawn's placement and a route's points as
 * the database has them (the originals an edit is measured against), how many spawns walk a route,
 * and whether the database has moved away from an original since it was read.
 */

const num = (value: string | null | undefined, fallback = 0): number => {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/** Differences smaller than this are the same place: the database rounds floats */
const SAME = 1e-4;
const near = (a: number, b: number): boolean => Math.abs(a - b) <= SAME;

const hasTable = async (db: WorldDb, table: string): Promise<boolean> => (await db.columns(table)).length > 0;

const placementOf = (kind: WorldSpawnKind, row: RawRow): Placement => ({
  x: num(row.position_x),
  y: num(row.position_y),
  z: num(row.position_z),
  orientation: num(row.orientation),
  rotation:
    kind === 'gameobject' && 'rotation0' in row
      ? [num(row.rotation0), num(row.rotation1), num(row.rotation2), num(row.rotation3, 1)]
      : null,
});

/** A spawn as the database has it, with its entry, name and map; null when it is gone */
export async function readPlacement(
  db: WorldDb,
  kind: WorldSpawnKind,
  guid: number,
): Promise<{ entry: number; name: string; map: number; placement: Placement } | null> {
  const [row] = await db.selectRows(kind, { guid: String(guid) });
  if (!row) return null;
  const entry = num(row[spawnEntryColumn(kind, (await db.columns(kind)).map((c) => c.name))]);
  const template = kind === 'creature' ? 'creature_template' : 'gameobject_template';
  const [named] = await db.selectRows(template, { entry: String(entry) });
  return { entry, name: named?.name ?? '', map: num(row.map), placement: placementOf(kind, row) };
}

/** Every `waypoint_data` column a point keeps as it is; the rest are what the view edits */
const EDITED = new Set(['id', 'point', 'position_x', 'position_y', 'position_z']);

/** A route's points in `point` order, each with its other columns; none when the route is gone */
export async function readRoute(db: WorldDb, pathId: number): Promise<RoutePoint[]> {
  const rows = await db.selectRows('waypoint_data', { id: String(pathId) });
  return [...rows]
    .sort((a, b) => num(a.point) - num(b.point))
    .map((row) => ({
      x: num(row.position_x),
      y: num(row.position_y),
      z: num(row.position_z),
      rest: Object.fromEntries(Object.entries(row).filter(([column]) => !EDITED.has(column))),
    }));
}

/** Spawns that walk a route: their own addon names it, or their template's does */
export async function countWalkers(db: WorldDb, pathId: number): Promise<number> {
  const own = (await hasTable(db, 'creature_addon')) ? (await db.selectRows('creature_addon', { path_id: String(pathId) })).length : 0;
  if (!(await hasTable(db, 'creature_template_addon'))) return own;
  const entries = (await db.selectRows('creature_template_addon', { path_id: String(pathId) })).map((r) => r.entry ?? '');
  if (entries.length === 0) return own;
  const entryColumn = spawnEntryColumn('creature', (await db.columns('creature')).map((c) => c.name));
  return own + (await db.selectRows('creature', { [entryColumn]: entries })).length;
}

/** Whether the database no longer holds a spawn's original placement */
export async function spawnDrifted(db: WorldDb, edit: WorldSpawnEdit): Promise<boolean> {
  const now = await readPlacement(db, edit.kind, edit.guid);
  if (!now) return true;
  const a = now.placement;
  const b = edit.original;
  const turned = a.rotation && b.rotation ? a.rotation.some((v, i) => !near(v, b.rotation![i]!)) : false;
  return !near(a.x, b.x) || !near(a.y, b.y) || !near(a.z, b.z) || !near(a.orientation, b.orientation) || turned;
}

/** Whether the database no longer holds a route's original points */
export async function routeDrifted(db: WorldDb, edit: WorldRouteEdit): Promise<boolean> {
  const now = await readRoute(db, edit.pathId);
  return now.length !== edit.original.length || now.some((p, i) => !near(p.x, edit.original[i]!.x) || !near(p.y, edit.original[i]!.y) || !near(p.z, edit.original[i]!.z));
}

/** The tables a world patch writes, as the export renders them */
export async function worldSchema(db: WorldDb, hash: string): Promise<SchemaInfo> {
  const tables: SchemaInfo['tables'] = {};
  for (const table of ['creature', 'gameobject', 'waypoint_data']) tables[table] = await db.columns(table);
  return { tables, forbidden: [], hash };
}
