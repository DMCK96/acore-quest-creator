/**
 * What is selected in the 3D view, apart from drawing it: NPCs and objects, points of NPCs' routes,
 * and the routes being worked on (shown, and open to a box or a click). Picking an NPC makes its
 * route (or wander circle) active, whether or not it is drawn yet; picking points of a route keeps it
 * active, so its NPC need not stay selected.
 */

import { isDeleted, type WorldLayer } from '@core/world/layer';

export type SelectedSpawn = { kind: 'creature' | 'object'; guid: number };
/** A point of an NPC's route: `guid` is the NPC whose route it is */
export type SelectedPoint = { guid: number; index: number };

export interface Selection {
  spawns: SelectedSpawn[];
  points: SelectedPoint[];
  /** NPCs whose routes are shown and whose points a box or click can catch */
  routes: number[];
}

/** Plain picks replace, Shift adds, Ctrl takes away */
export type Modifier = 'replace' | 'add' | 'remove';

/** What a click or a box caught: spawns, or points of active routes */
export type Hit = { spawns: SelectedSpawn[] } | { points: SelectedPoint[] };

export const EMPTY_SELECTION: Selection = { spawns: [], points: [], routes: [] };

const spawnKey = (s: SelectedSpawn) => `${s.kind}:${s.guid}`;
const pointKey = (p: SelectedPoint) => `${p.guid}:${p.index}`;

/** The items of both lists, each once, in the order first seen */
function union<T>(a: readonly T[], b: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return [...a, ...b].filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function without<T>(a: readonly T[], b: readonly T[], key: (item: T) => string): T[] {
  const gone = new Set(b.map(key));
  return a.filter((item) => !gone.has(key(item)));
}

const withRoutes = (routes: readonly number[], guids: readonly number[]): number[] => [...new Set([...routes, ...guids])];

export function combine(current: Selection, hit: Hit, modifier: Modifier): Selection {
  const caught = 'spawns' in hit ? hit.spawns : hit.points;
  // A pick of nothing changes nothing: a miss while working on a route must not lose it (a
  // double-click on nothing, Esc or Deselect clears)
  if (caught.length === 0) return current;

  if ('spawns' in hit) {
    const routed = hit.spawns.filter((s) => s.kind === 'creature').map((s) => s.guid);
    if (modifier === 'replace') return { spawns: union([], hit.spawns, spawnKey), points: [], routes: withRoutes([], routed) };
    if (modifier === 'add') return { spawns: union(current.spawns, hit.spawns, spawnKey), points: current.points, routes: withRoutes(current.routes, routed) };
    // A removed NPC's route stays active while any of its points is picked
    const removed = new Set(hit.spawns.filter((s) => s.kind === 'creature').map((s) => s.guid));
    const kept = new Set(current.points.map((p) => p.guid));
    return {
      spawns: without(current.spawns, hit.spawns, spawnKey),
      points: current.points,
      routes: current.routes.filter((guid) => !removed.has(guid) || kept.has(guid)),
    };
  }

  const guids = hit.points.map((p) => p.guid);
  if (modifier === 'replace') return { spawns: [], points: union([], hit.points, pointKey), routes: withRoutes(current.routes, guids) };
  if (modifier === 'add') return { spawns: current.spawns, points: union(current.points, hit.points, pointKey), routes: withRoutes(current.routes, guids) };
  return { spawns: current.spawns, points: without(current.points, hit.points, pointKey), routes: current.routes };
}

/** The picked points of one route after points were deleted from it or one was inserted */
export function afterRouteChange(
  selection: Selection,
  guid: number,
  change: { kind: 'delete'; indexes: number[] } | { kind: 'insert'; index: number },
): Selection {
  const points = selection.points.flatMap((p): SelectedPoint[] => {
    if (p.guid !== guid) return [p];
    if (change.kind === 'insert') return [{ guid, index: p.index >= change.index ? p.index + 1 : p.index }];
    if (change.indexes.includes(p.index)) return [];
    return [{ guid, index: p.index - change.indexes.filter((i) => i < p.index).length }];
  });
  return { ...selection, points };
}

/**
 * The selection once the layer deletes spawns: a deleted spawn is let go, and so is its route unless a
 * point of it is still picked. The same selection when nothing selected is deleted.
 */
export function withoutDeleted(selection: Selection, layer: WorldLayer): Selection {
  const gone = (s: SelectedSpawn): boolean => isDeleted(layer, s.kind === 'creature' ? 'creature' : 'gameobject', s.guid);
  if (!selection.spawns.some(gone)) return selection;
  const dropped = new Set(selection.spawns.filter((s) => s.kind === 'creature' && gone(s)).map((s) => s.guid));
  const picked = new Set(selection.points.map((p) => p.guid));
  return {
    spawns: selection.spawns.filter((s) => !gone(s)),
    points: selection.points,
    routes: selection.routes.filter((guid) => !dropped.has(guid) || picked.has(guid)),
  };
}

export function isEmpty(selection: Selection): boolean {
  return selection.spawns.length === 0 && selection.points.length === 0 && selection.routes.length === 0;
}
