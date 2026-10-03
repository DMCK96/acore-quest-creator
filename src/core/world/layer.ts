import type { PatchStatement } from '../export/build-patch';

/**
 * The world layer: edits made in the 3D view to spawns and routes that are not part of any quest
 * (moving Northshire's mailbox, rerouting a guard). Each entry keeps what the database had at its
 * first edit, so it can be listed as before and after, reverted, and written as a patch and its
 * revert. Everything here is pure: each function returns a new layer.
 */

/** Where a spawn stands and how it is turned; `rotation` (x, y, z, w) is an object's, null for an NPC */
export type Placement = { x: number; y: number; z: number; orientation: number; rotation: [number, number, number, number] | null };

export type WorldSpawnKind = 'creature' | 'gameobject';

export interface WorldSpawnEdit {
  kind: WorldSpawnKind;
  guid: number;
  entry: number;
  name: string;
  map: number;
  original: Placement;
  current: Placement;
}

/** One point of a route; `rest` is every other `waypoint_data` column, kept as the database had it */
export type RoutePoint = { x: number; y: number; z: number; rest: Record<string, string | null> };

export interface WorldRouteEdit {
  pathId: number;
  /** Spawns that walk the route, counted at its first edit */
  walkers: number;
  original: RoutePoint[];
  current: RoutePoint[];
}

export interface WorldLayer {
  spawns: WorldSpawnEdit[];
  routes: WorldRouteEdit[];
}

export const EMPTY_WORLD: WorldLayer = { spawns: [], routes: [] };

/** What a point added in the 3D view has in the columns the view does not edit */
export const NEW_POINT_REST: Record<string, string | null> = {
  orientation: null,
  delay: '0',
  move_type: '0',
  action: '0',
  action_chance: '100',
  wpguid: '0',
};

const samePlacement = (a: Placement, b: Placement): boolean =>
  a.x === b.x &&
  a.y === b.y &&
  a.z === b.z &&
  a.orientation === b.orientation &&
  (a.rotation === null || b.rotation === null ? a.rotation === b.rotation : a.rotation.every((v, i) => v === b.rotation![i]));

const samePoint = (a: RoutePoint, b: RoutePoint): boolean => {
  const keys = Object.keys(a.rest);
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.z === b.z &&
    keys.length === Object.keys(b.rest).length &&
    keys.every((k) => Object.prototype.hasOwnProperty.call(b.rest, k) && a.rest[k] === b.rest[k])
  );
};

const sameRoute = (a: readonly RoutePoint[], b: readonly RoutePoint[]): boolean => a.length === b.length && a.every((p, i) => samePoint(p, b[i]!));

/** Moves or turns a spawn; its first original is kept, and an entry back where it began is dropped */
export function moveSpawn(layer: WorldLayer, spawn: Omit<WorldSpawnEdit, 'current'>, to: Placement): WorldLayer {
  const known = layer.spawns.find((s) => s.kind === spawn.kind && s.guid === spawn.guid);
  const entry: WorldSpawnEdit = known ? { ...known, current: to } : { ...spawn, current: to };
  const unchanged = samePlacement(entry.current, entry.original);
  const spawns = known
    ? layer.spawns.flatMap((s) => (s === known ? (unchanged ? [] : [entry]) : [s]))
    : unchanged
      ? layer.spawns
      : [...layer.spawns, entry];
  return { ...layer, spawns };
}

/** Sets a route's points; its first original and walker count are kept, and a route put back is dropped */
export function setRoute(layer: WorldLayer, route: Omit<WorldRouteEdit, 'current'>, points: RoutePoint[]): WorldLayer {
  const known = layer.routes.find((r) => r.pathId === route.pathId);
  const entry: WorldRouteEdit = known ? { ...known, current: points } : { ...route, current: points };
  const unchanged = sameRoute(entry.current, entry.original);
  const routes = known
    ? layer.routes.flatMap((r) => (r === known ? (unchanged ? [] : [entry]) : [r]))
    : unchanged
      ? layer.routes
      : [...layer.routes, entry];
  return { ...layer, routes };
}

export function revertSpawn(layer: WorldLayer, kind: WorldSpawnKind, guid: number): WorldLayer {
  return { ...layer, spawns: layer.spawns.filter((s) => !(s.kind === kind && s.guid === guid)) };
}

export function revertRoute(layer: WorldLayer, pathId: number): WorldLayer {
  return { ...layer, routes: layer.routes.filter((r) => r.pathId !== pathId) };
}

const text = (n: number): string => String(n);

function placementStatement(spawn: WorldSpawnEdit, at: Placement): PatchStatement {
  const set: Record<string, string> = { position_x: text(at.x), position_y: text(at.y), position_z: text(at.z), orientation: text(at.orientation) };
  if (spawn.kind === 'gameobject' && at.rotation) at.rotation.forEach((v, i) => (set[`rotation${i}`] = text(v)));
  return { kind: 'update', table: spawn.kind, key: { guid: text(spawn.guid) }, set };
}

/**
 * What a point has in the columns it does not carry: the database's own defaults for every column it
 * has (a fork's extra `velocity`, say), with a new point's usual values where the database has them
 */
function pointBase(columnDefaults: Record<string, string | null> | undefined): Record<string, string | null> {
  if (!columnDefaults) return NEW_POINT_REST;
  const usual = Object.entries(NEW_POINT_REST).filter(([column]) => column in columnDefaults);
  return { ...columnDefaults, ...Object.fromEntries(usual) };
}

function routeStatements(pathId: number, points: readonly RoutePoint[], base: Record<string, string | null>): PatchStatement[] {
  const id = text(pathId);
  return [
    { kind: 'delete', table: 'waypoint_data', key: { id } },
    ...points.map((p, i): PatchStatement => ({
      kind: 'insert',
      table: 'waypoint_data',
      row: { ...base, id, point: text(i + 1), position_x: text(p.x), position_y: text(p.y), position_z: text(p.z), ...p.rest },
    })),
  ];
}

/**
 * The layer as a patch, and the patch that puts the database back as it was: spawns first, then
 * routes. `pointDefaults` is every `waypoint_data` column's default in the database written to, so a
 * point added in the view fills columns this tool does not know about.
 */
export function worldStatements(
  layer: WorldLayer,
  pointDefaults?: Record<string, string | null>,
): { apply: PatchStatement[]; revert: PatchStatement[] } {
  const base = pointBase(pointDefaults);
  return {
    apply: [...layer.spawns.map((s) => placementStatement(s, s.current)), ...layer.routes.flatMap((r) => routeStatements(r.pathId, r.current, base))],
    revert: [...layer.spawns.map((s) => placementStatement(s, s.original)), ...layer.routes.flatMap((r) => routeStatements(r.pathId, r.original, base))],
  };
}
