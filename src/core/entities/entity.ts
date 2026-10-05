import type { Placement } from '../world/layer';

/**
 * NPCs, objects and items as one kind of thing: what it is (an `Entity`, new in the project or
 * already in the database) and, for NPCs and objects, where one stands (a `SpawnPoint`). The 3D
 * view's right-click menu and the project's change list are built from these.
 */

/** What an entity is */
export type EntityKind = 'npc' | 'object' | 'item';

/** An entity by kind and entry */
export interface EntityRef {
  kind: EntityKind;
  entry: number;
}

/** Whether the project creates it (`new`) or the database already has it (`existing`) */
export type EntityOrigin = 'new' | 'existing';

/** An NPC, object or item, with the name it is shown by */
export interface Entity extends EntityRef {
  name: string;
  origin: EntityOrigin;
}

/** One place an entity stands: its guid, map and where, whether the project placed it, and its spawn group */
export interface SpawnPoint {
  guid: number;
  map: number;
  placement: Placement;
  origin: EntityOrigin;
  /** The spawn group (pool) it is in, or null */
  group: number | null;
}

/** An entity that stands somewhere: an NPC or an object, with the spawn that was clicked */
export interface SpawnedEntity extends Entity {
  kind: 'npc' | 'object';
  spawn: SpawnPoint;
}

/** A spawned NPC, with the path it walks (0 for none) and its wander circle (0 for none) */
export interface NpcSpawn extends SpawnedEntity {
  kind: 'npc';
  pathId: number;
  wander: number;
}

/** A spawned object; `lootable` is null when it is the database's and cannot be changed */
export interface ObjectSpawn extends SpawnedEntity {
  kind: 'object';
  lootable: boolean | null;
}

/** What the project changes about an entity */
export type EntityChange = 'new' | 'spawns' | 'movement' | 'path' | 'details' | 'group';

/** A spawn the view can go to; where it stands is left out when it was not read (the view reads it before going) */
export interface SpawnLocation {
  kind: 'creature' | 'object';
  guid: number;
  map: number;
  x?: number;
  y?: number;
  z?: number;
}

/** An entity the project tracks: what it changes, the quests that use it and where to find it */
export interface TrackedEntity extends Entity {
  changes: EntityChange[];
  usedBy: number[];
  goTo: SpawnLocation | null;
}

/** The entity kind of a spawn kind, as the 3D view (`creature`, `object`) or the world layer (`gameobject`) names it */
export function spawnKindOf(kind: 'creature' | 'object' | 'gameobject'): 'npc' | 'object' {
  return kind === 'creature' ? 'npc' : 'object';
}
