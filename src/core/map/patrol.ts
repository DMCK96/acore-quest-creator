import { ENTITIES_FIELD, readEntities, writeEntities, type Pace, type Patrol, type PatrolPoint, type PointAction } from '../entities/model';
import type { FieldValue } from '../registry/types';

/**
 * Edits to a new NPC's patrol, all pure: each returns a new patrol and leaves the one given as it
 * was. An index or action id that is not there changes nothing.
 */

type Values = Readonly<Record<string, unknown>>;
export type At = { x: number; y: number; z: number };

/** How long a point waits when a pose or a facing is chosen on a point that did not wait. */
export const DEFAULT_POSE_WAIT = 10;

export function newPatrol(pathId: number): Patrol {
  return { pathId, startPace: 'walk', points: [] };
}

const newPoint = (at: At): PatrolPoint => ({ x: at.x, y: at.y, z: at.z, waitSecs: 0, facing: null, paceFromHere: null, actions: [] });
const has = (p: Patrol, index: number): boolean => index >= 0 && index < p.points.length;
const withPoint = (p: Patrol, index: number, change: (point: PatrolPoint) => PatrolPoint): Patrol =>
  has(p, index) ? { ...p, points: p.points.map((q, i) => (i === index ? change(q) : q)) } : p;
/** A pose or facing only shows while the NPC stands still, so a point with either waits. */
const waiting = (point: PatrolPoint): PatrolPoint => (point.waitSecs === 0 ? { ...point, waitSecs: DEFAULT_POSE_WAIT } : point);

export function addPoint(p: Patrol, at: At): Patrol {
  return { ...p, points: [...p.points, newPoint(at)] };
}

/** A new point that takes `points[index]`'s place, pushing it and the rest one on. */
export function insertPoint(p: Patrol, index: number, at: At): Patrol {
  if (index < 0 || index > p.points.length) return p;
  return { ...p, points: [...p.points.slice(0, index), newPoint(at), ...p.points.slice(index)] };
}

export function movePoint(p: Patrol, index: number, at: At): Patrol {
  return withPoint(p, index, (point) => ({ ...point, x: at.x, y: at.y, z: at.z }));
}

export function removePoint(p: Patrol, index: number): Patrol {
  return has(p, index) ? { ...p, points: p.points.filter((_, i) => i !== index) } : p;
}

export function updatePoint(p: Patrol, index: number, change: Partial<Pick<PatrolPoint, 'waitSecs' | 'facing' | 'paceFromHere'>>): Patrol {
  return withPoint(p, index, (point) => {
    const next = { ...point, ...change };
    return change.facing !== undefined && change.facing !== null ? waiting(next) : next;
  });
}

export function setStartPace(p: Patrol, pace: Pace): Patrol {
  return { ...p, startPace: pace };
}

/** No points, but the same path id, so the next export still finds and deletes the old route. */
export function clearRoute(p: Patrol): Patrol {
  return { ...p, points: [] };
}

/** `a<n>` one above the highest such id on the point. */
export function nextActionId(point: PatrolPoint): string {
  const highest = point.actions.reduce((max, a) => {
    const match = /^a(\d+)$/.exec(a.id);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `a${highest + 1}`;
}

export function addAction(p: Patrol, index: number, action: PointAction): Patrol {
  return withPoint(p, index, (point) => {
    const next = { ...point, actions: [...point.actions, action] };
    return action.kind === 'pose' ? waiting(next) : next;
  });
}

/** Replaces the action with the same id. */
export function updateAction(p: Patrol, index: number, action: PointAction): Patrol {
  return withPoint(p, index, (point) => ({ ...point, actions: point.actions.map((a) => (a.id === action.id ? action : a)) }));
}

export function moveAction(p: Patrol, index: number, actionId: string, by: -1 | 1): Patrol {
  const point = p.points[index];
  const from = point?.actions.findIndex((a) => a.id === actionId) ?? -1;
  if (!point || from < 0 || from + by < 0 || from + by >= point.actions.length) return p;
  const actions = [...point.actions];
  const [taken] = actions.splice(from, 1);
  actions.splice(from + by, 0, taken!);
  return withPoint(p, index, (q) => ({ ...q, actions }));
}

export function removeAction(p: Patrol, index: number, actionId: string): Patrol {
  return withPoint(p, index, (point) => ({ ...point, actions: point.actions.filter((a) => a.id !== actionId) }));
}

/** The facing from one point toward another: 0 is north (+x), a quarter turn is west (+y). */
export function facingToward(from: { x: number; y: number }, to: { x: number; y: number }): number {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  return angle < 0 ? angle + 2 * Math.PI : angle;
}

/** The segment of a closed route (the last point joins back to the first) nearest a point. */
export function nearestSegment(route: readonly { x: number; y: number }[], at: { x: number; y: number }): number {
  let best = 0;
  let bestDistance = Infinity;
  route.forEach((a, i) => {
    const b = route[(i + 1) % route.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = dx * dx + dy * dy;
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((at.x - a.x) * dx + (at.y - a.y) * dy) / length));
    const distance = Math.hypot(at.x - (a.x + t * dx), at.y - (a.y + t * dy));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  });
  return best;
}

export function patrolOf(values: Values, entry: number, guid: number): Patrol | null {
  const npc = readEntities(values).npcs.find((n) => n.entry === entry);
  return npc?.spawns.find((s) => s.guid === guid)?.patrol ?? null;
}

export function setPatrol(values: Values, entry: number, guid: number, patrol: Patrol): { field: string; value: FieldValue } | null {
  const entities = readEntities(values);
  const npc = entities.npcs.find((n) => n.entry === entry);
  if (!npc || !npc.spawns.some((s) => s.guid === guid)) return null;
  const next = { ...npc, spawns: npc.spawns.map((s) => (s.guid === guid ? { ...s, patrol } : s)) };
  return { field: ENTITIES_FIELD, value: writeEntities({ ...entities, npcs: entities.npcs.map((n) => (n === npc ? next : n)) }) };
}
