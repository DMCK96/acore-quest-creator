/**
 * How an NPC spawn moves: it stands, wanders within a radius, or walks a path. The server reads this
 * from `creature.MovementType` and `wander_distance`, and the path from `creature_addon.path_id`.
 */

export type Movement = { type: 'idle' | 'wander' | 'path'; wander: number; pathId: number | null };

export const IDLE: Movement = { type: 'idle', wander: 0, pathId: null };

/** `creature.MovementType`: 0 stands, 1 roams at random within its wander distance, 2 walks its path */
export const MOVEMENT_TYPE = { idle: 0, wander: 1, path: 2 } as const;

/** A spawn's movement from its row; a path id is kept whatever the type, since the addon row has it */
export function movementOfRow(row: { MovementType?: string | null; wander_distance?: string | null; path_id?: string | null }): Movement {
  const type = Number(row.MovementType ?? 0);
  const path = Number(row.path_id ?? 0);
  const pathId = Number.isFinite(path) && path > 0 ? path : null;
  if (type === MOVEMENT_TYPE.wander) return { type: 'wander', wander: Number(row.wander_distance ?? 0) || 0, pathId };
  if (type === MOVEMENT_TYPE.path) return { type: 'path', wander: 0, pathId };
  return { type: 'idle', wander: 0, pathId };
}

export const sameMovement = (a: Movement, b: Movement): boolean => a.type === b.type && a.wander === b.wander && a.pathId === b.pathId;
