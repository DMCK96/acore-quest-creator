import type { PatrolPoint } from '@core/entities/model';
import { newPatrolPoint, patrolOf, setPatrol } from '@core/map/patrol';
import { placeSpawn } from '@core/map/positions';
import type { FieldValue } from '@core/registry/types';
import type { EditPoint, SpawnEdit } from '../world3d/edits';

type Values = Readonly<Record<string, unknown>>;

/**
 * Route points from the 3D view as a patrol's: each keeps the patrol point it carries (its wait,
 * facing, actions) at its new place, and a point added in 3D is a new one that does not wait.
 */
export function toPatrolPoints(points: readonly EditPoint[]): PatrolPoint[] {
  return points.map((p) => (p.carry ? { ...(p.carry as PatrolPoint), x: p.x, y: p.y, z: p.z } : newPatrolPoint(p)));
}

/** An edit to one of the quest's own spawns, from the 3D view, as a change to the quest; null when it is not one */
export function ownEdit(values: Values, edit: SpawnEdit): { field: string; value: FieldValue } | null {
  const { kind, entry, guid } = edit.spawn;
  if (edit.kind === 'place') return placeSpawn(values, `spawn:${kind === 'creature' ? 'npc' : 'obj'}:${entry}:${guid}`, edit.to);
  if (edit.kind !== 'route') return null;
  const patrol = patrolOf(values, entry, guid);
  return patrol ? setPatrol(values, entry, guid, { ...patrol, points: toPatrolPoints(edit.points) }) : null;
}
