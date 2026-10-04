import type { PatrolPoint } from '@core/entities/model';
import { newPatrol, newPatrolPoint, patrolOf, setPatrol } from '@core/map/patrol';
import { addSpawn, placeSpawn, removeSpawn, setSpawnMovement } from '@core/map/positions';
import { readEntities } from '@core/entities/model';
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
  const id = `spawn:${kind === 'creature' ? 'npc' : 'obj'}:${entry}:${guid}`;
  const owner = kind === 'creature' ? 'npc' : 'object';
  if (edit.kind === 'place') return placeSpawn(values, id, edit.to);
  if (edit.kind === 'presence') {
    if (!edit.present) return removeSpawn(values, { kind: owner, entry }, guid);
    const { x, y, z, orientation } = edit.at;
    const added = addSpawn(values, { kind: owner, entry }, { guid, map: edit.map, x, y, z, o: orientation });
    // An object keeps its whole turn, which placing writes
    return added && kind === 'object' ? (placeSpawn({ ...values, [added.field]: added.value }, id, edit.at) ?? added) : added;
  }
  if (edit.kind === 'movement') return kind === 'creature' ? setSpawnMovement(values, entry, guid, edit.to) : null;
  const patrol = patrolOf(values, entry, guid);
  if (patrol) return setPatrol(values, entry, guid, { ...patrol, points: toPatrolPoints(edit.points) });
  // A route for an NPC with no patrol yet: a path drawn in 3D starts one
  const walks = readEntities(values).npcs.some((n) => n.entry === entry && n.spawns.some((s) => s.guid === guid));
  return walks ? setPatrol(values, entry, guid, { ...newPatrol(edit.pathId), points: toPatrolPoints(edit.points) }) : null;
}
