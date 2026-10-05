import type { NpcSpawn, ObjectSpawn, SpawnPoint } from '@core/entities/entity';
import { spawnKindOf } from '@core/entities/entity';
import type { ProjectEntities } from '@core/entities/model';
import type { At, MenuSpawn, MenuTarget } from './model';

/**
 * What a right-click landed on, as the menu's sections see it: the ground, a spawn (as an entity,
 * with the 3D view's own spawn record the actions edit through) or a point of a route.
 */
export type MenuSubject =
  | { type: 'ground'; at: At | null; selection: MenuSpawn[] }
  | { type: 'spawn'; target: NpcSpawn | ObjectSpawn; info: MenuSpawn; at: At | null; selection: MenuSpawn[] }
  | { type: 'routePoint'; guid: number; index: number; at: At | null };

/** A drawn spawn as an entity: new when the project made it, and its spawn new when the project placed it */
export function spawnedEntityOf(info: MenuSpawn, store: ProjectEntities): NpcSpawn | ObjectSpawn {
  const kind = spawnKindOf(info.kind);
  const spawn: SpawnPoint = { guid: info.guid, map: info.map, placement: info.placement, origin: info.own || info.added ? 'new' : 'existing' };
  if (kind === 'npc') {
    const origin = store.npcs.some((n) => n.entry === info.entry) ? 'new' : 'existing';
    return { kind, entry: info.entry, name: info.name, origin, pathId: info.pathId, wander: info.wander, spawn };
  }
  const own = store.objects.find((o) => o.entry === info.entry);
  return { kind, entry: info.entry, name: info.name, origin: own ? 'new' : 'existing', lootable: own ? own.type === 'chest' : null, spawn };
}

/** The subject of a right-click target */
export function subjectOf(target: MenuTarget, store: ProjectEntities): MenuSubject {
  const { hit, ground, selection } = target;
  if (!hit) return { type: 'ground', at: ground, selection };
  if (hit.type === 'spawn') return { type: 'spawn', target: spawnedEntityOf(hit.spawn, store), info: hit.spawn, at: ground, selection };
  return { type: 'routePoint', guid: hit.guid, index: hit.index, at: ground };
}
