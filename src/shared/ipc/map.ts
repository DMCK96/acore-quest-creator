import type { MapBox, SpawnDot } from '@core/db/spawns';
import type { ViewSpawns } from '@core/db/view-spawns';
import type { Result } from './result';

export type { MapBox, SpawnDot, SpawnKind } from '@core/db/spawns';

/** A map the quest map can show: its name and its zones' names, placed at their middles. */
export interface MapInfo {
  id: number;
  name: string;
  zones: { name: string; x: number; y: number }[];
}

/** The floors at a point (navmesh) and the terrain ground there, or why there are none. */
export type MapFloors = { floors: number[]; ground: number | null } | { reason: string };

/** An existing spawn of one of the quest's givers, enders or objectives, shown read-only on its map. */
export interface QuestMapRef extends SpawnDot {
  role: 'giver' | 'ender' | 'objective';
}

/** A spawn a quest uses: an existing one it names by role, or one of its own */
export type QuestSpawn = SpawnDot & { role: 'giver' | 'ender' | 'objective' | 'own' };

/** One quest's spawns for the 3D view; `cut` NPCs or objects had more than were listed (`capped` when any did) */
export interface QuestSpawnGroup {
  questId: number;
  title: string;
  spawns: QuestSpawn[];
  capped: boolean;
  cut: number;
  /** The world database was not read: only the project's own spawns and the World layer's are listed */
  offline?: boolean;
}

/** The quest map and the 3D view: ground, floors, maps, spawns near a place or of a quest, and new path ids */
export interface MapApi {
  /** The `waypoint_data` path a new NPC's spawn patrols: guid × 10 when free, else above every path in use. */
  patrolPathId(guid: number): Promise<Result<number>>;
  /** A free path id for a new path of an NPC: its guid times ten when that is free, else one past the highest in use. */
  worldNewPathId(guid: number): Promise<Result<number>>;
  /** The terrain height at a point, from the server data folder's map files, or why there is none. */
  groundHeight(map: number, x: number, y: number): Promise<Result<{ z: number } | { reason: string }>>;
  /** The maps the quest map shows, with zone names. */
  mapList(): Promise<Result<MapInfo[]>>;
  /** The walkable floors and the ground at a point, from the server data folder. */
  mapFloors(map: number, x: number, y: number): Promise<Result<MapFloors>>;
  /** Existing NPC and object spawns in an area of a map; `capped` when there were more than the page is sent. */
  mapSpawns(map: number, box: MapBox): Promise<Result<{ dots: SpawnDot[]; capped: boolean }>>;
  /** NPCs and objects in an area of a map as the 3D view draws them; each kind capped at 2000. */
  viewSpawns(map: number, box: MapBox): Promise<Result<ViewSpawns>>;
  /** Where an NPC or object stands in the world, for jumping to it on the map. */
  entitySpawns(kind: 'creature' | 'gameobject', entry: number): Promise<Result<SpawnDot[]>>;
  /** Every spawn of one NPC or object (up to a few hundred, `capped` when there are more), for jumping to them in the 3D view. */
  findSpawns(kind: 'creature' | 'gameobject', entry: number): Promise<Result<{ spawns: SpawnDot[]; capped: boolean }>>;
  /** Where one spawn stands: as moved or placed in the project, else as the database has it; null when it is gone. For Go to. */
  spawnPlacement(kind: 'npc' | 'object', guid: number): Promise<Result<{ x: number; y: number; z: number } | null>>;
  /** The existing spawns of the quest's givers, enders and objectives. */
  questMapRefs(questId: number): Promise<Result<QuestMapRef[]>>;
  /** Every spawn each quest uses (its givers', enders' and objectives', and its own), for the 3D view to list and mark. */
  questSpawnList(questIds: number[]): Promise<Result<QuestSpawnGroup[]>>;
}
