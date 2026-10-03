import type { ViewCreature, ViewObject, ViewSpawns } from '../db/view-spawns';
import type { CustomNpc, CustomObject } from './model';

/**
 * The open quest's own new NPCs and objects as the 3D view draws them: each spawn with its entity's
 * look, scale and weapons, how it moves, and marked as the project's (not yet in the database).
 */
export function ownViewSpawns(entities: { npcs: readonly CustomNpc[]; objects: readonly CustomObject[] }): ViewSpawns {
  const creatures: ViewCreature[] = entities.npcs.flatMap((npc) =>
    npc.spawns.map((spawn) => ({
      guid: spawn.guid,
      entry: npc.entry,
      name: npc.name,
      map: spawn.map,
      x: spawn.x,
      y: spawn.y,
      z: spawn.z,
      orientation: spawn.o,
      displayId: npc.displayId,
      scale: npc.scale,
      // A patrolling spawn walks its route; it does not also wander
      wander: spawn.patrol ? 0 : spawn.wander,
      // Each point carries its whole patrol point, so a route edited in 3D keeps its waits and actions
      path: spawn.patrol ? spawn.patrol.points.map((p) => ({ x: p.x, y: p.y, z: p.z, carry: p })) : null,
      pathId: spawn.patrol ? spawn.patrol.pathId : 0,
      equipment: [npc.equipment.mainHand, npc.equipment.offHand, npc.equipment.ranged],
      own: true,
      event: null,
    })),
  );

  // Turned about Z by its facing, as export writes rotation2 and rotation3
  const objects: ViewObject[] = entities.objects.flatMap((object) =>
    object.spawns.map((spawn) => ({
      guid: spawn.guid,
      entry: object.entry,
      name: object.name,
      map: spawn.map,
      x: spawn.x,
      y: spawn.y,
      z: spawn.z,
      rotation: [0, 0, Math.sin(spawn.o / 2), Math.cos(spawn.o / 2)],
      displayId: object.displayId,
      scale: object.size,
      own: true,
      event: null,
    })),
  );

  return { creatures, objects, capped: { creatures: false, objects: false } };
}
