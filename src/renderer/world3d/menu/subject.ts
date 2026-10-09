import type { NpcSpawn, ObjectSpawn, SpawnPoint } from '@core/entities/entity';
import { spawnKindOf } from '@core/entities/entity';
import { OBJECT_TYPE_VALUE, originOf, type ProjectEntities } from '@core/entities/model';
import type { At, MenuSpawn, MenuTarget } from './model';

type Vessel = MenuTarget['vessel'];

/**
 * What a right-click landed on, as the menu's sections see it: the ground, a spawn (as an entity,
 * with the 3D view's own spawn record the actions edit through) or a point of a route.
 */
export type MenuSubject =
  | { type: 'ground'; at: At | null; selection: MenuSpawn[]; vessel?: Vessel }
  /** `stored`: the project holds its NPC or object (made here, or an existing one brought in) */
  | { type: 'spawn'; target: NpcSpawn | ObjectSpawn; stored: boolean; info: MenuSpawn; at: At | null; selection: MenuSpawn[]; vessel?: Vessel }
  /** `own`: the route is a project NPC's patrol, not one the database has */
  | { type: 'routePoint'; guid: number; index: number; own: boolean; at: At | null };

/**
 * A drawn spawn as an entity: its origin is the stored one when the project holds the entry (made
 * here, or an existing one edited here) and existing otherwise; its spawn is new when the project
 * placed it. An object can be made lootable when the project holds it and its type is not locked; one
 * the project does not hold yet can be when its template is of a type the editor models (by that type).
 */
export function spawnedEntityOf(info: MenuSpawn, store: ProjectEntities): NpcSpawn | ObjectSpawn {
  const kind = spawnKindOf(info.kind);
  const spawn: SpawnPoint = { guid: info.guid, map: info.map, placement: info.placement, origin: info.own || info.added ? 'new' : 'existing', group: info.group ?? null };
  if (kind === 'npc') {
    const stored = store.npcs.find((n) => n.entry === info.entry);
    // The project's stock is counted; a database NPC the project has not opened is a vendor by its flags
    const vendor = stored ? { sells: stored.vendor.length > 0, count: stored.vendor.length } : { sells: ((info.npcFlags ?? 0) & VENDOR_FLAG) !== 0, count: null };
    return { kind, entry: info.entry, name: info.name, origin: stored ? originOf(stored) : 'existing', pathId: info.pathId, wander: info.wander, vendor, spawn };
  }
  const stored = store.objects.find((o) => o.entry === info.entry);
  const typeLocked = stored?.origin.kind === 'existing' && stored.origin.locked.includes('type');
  const lootable = stored ? (typeLocked ? null : stored.type === 'chest') : lootableByType(info.objectType);
  return { kind, entry: info.entry, name: info.name, origin: stored ? originOf(stored) : 'existing', lootable, spawn };
}

/** `npcflag` bit of an NPC that sells things */
const VENDOR_FLAG = 128;

/** The object types the editor models besides a chest: quest giver, generic, text and goober */
const MODELLED_TYPES = new Set([OBJECT_TYPE_VALUE.questGiver, OBJECT_TYPE_VALUE.generic, OBJECT_TYPE_VALUE.text, OBJECT_TYPE_VALUE.goober]);

/** Whether a database object of a template type is lootable, or null when the editor cannot change that type (or it is not known) */
function lootableByType(objectType: number | undefined): boolean | null {
  if (objectType === OBJECT_TYPE_VALUE.chest) return true;
  return objectType !== undefined && (MODELLED_TYPES as Set<number>).has(objectType) ? false : null;
}

/** Whether the project holds a drawn spawn's NPC or object */
function storedOf(info: MenuSpawn, store: ProjectEntities): boolean {
  const list: readonly { entry: number }[] = spawnKindOf(info.kind) === 'npc' ? store.npcs : store.objects;
  return list.some((e) => e.entry === info.entry);
}

/** The subject of a right-click target */
export function subjectOf(target: MenuTarget, store: ProjectEntities): MenuSubject {
  const { hit, ground, selection, vessel } = target;
  if (!hit) return { type: 'ground', at: ground, selection, vessel };
  if (hit.type === 'spawn') return { type: 'spawn', target: spawnedEntityOf(hit.spawn, store), stored: storedOf(hit.spawn, store), info: hit.spawn, at: ground, selection, vessel };
  const own = store.npcs.some((n) => n.spawns.some((s) => s.guid === hit.guid));
  return { type: 'routePoint', guid: hit.guid, index: hit.index, own, at: ground };
}
