import type { ViewCreature, ViewObject, ViewSpawns } from '../db/view-spawns';
import { originOf, type CustomNpc, type CustomObject, type ProjectEntities } from './model';

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
      events: [],
      removedBy: [],
      preset: null,
      group: null,
      respawnSecs: spawn.respawnSecs,
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
      rotation: spawn.rotation ?? [0, 0, Math.sin(spawn.o / 2), Math.cos(spawn.o / 2)],
      displayId: object.displayId,
      scale: object.size,
      own: true,
      event: null,
      events: [],
      removedBy: [],
      group: null,
      respawnSecs: spawn.respawnSecs,
    })),
  );

  return { creatures, objects, capped: { creatures: false, objects: false } };
}

/** The look of each edited existing NPC and object, keyed `creature:<entry>` / `object:<entry>` */
export type EntityLooks = ReadonlyMap<string, { displayId: number; scale: number; equipment?: [number, number, number] }>;

/** The looks of the store's existing entities (new ones are drawn as their own spawns) */
export function looksOf(store: ProjectEntities): EntityLooks {
  const looks = new Map<string, { displayId: number; scale: number; equipment?: [number, number, number] }>();
  for (const npc of store.npcs) {
    if (originOf(npc) !== 'existing') continue;
    looks.set(`creature:${npc.entry}`, { displayId: npc.displayId, scale: npc.scale, equipment: [npc.equipment.mainHand, npc.equipment.offHand, npc.equipment.ranged] });
  }
  for (const object of store.objects) {
    if (originOf(object) !== 'existing') continue;
    looks.set(`object:${object.entry}`, { displayId: object.displayId, scale: object.size });
  }
  return looks;
}

/** Database spawns drawn with the looks of their edited entities; others are left alone */
export function withLooks(spawns: ViewSpawns, looks: EntityLooks): ViewSpawns {
  if (looks.size === 0) return spawns;
  return {
    ...spawns,
    creatures: spawns.creatures.map((c) => {
      const look = looks.get(`creature:${c.entry}`);
      return look ? { ...c, displayId: look.displayId, scale: look.scale, equipment: look.equipment ?? c.equipment } : c;
    }),
    objects: spawns.objects.map((o) => {
      const look = looks.get(`object:${o.entry}`);
      return look ? { ...o, displayId: look.displayId, scale: look.scale } : o;
    }),
  };
}
