import type { WorldLayer } from '@core/world/layer';
import type { SpawnGroup } from '@core/world/groups';
import type { Result } from './result';

export type { GroupMember, SpawnGroup } from '@core/world/groups';

/** A spawn group as the 3D view describes it: each member by name, and where it stands (a group member at its spawns' centre) */
export interface GroupView {
  id: number;
  name: string;
  map: number;
  maxActive: number;
  /** The game event it follows, by name; null for always */
  event: { id: number; name: string; during: boolean } | null;
  members: { key: string; type: 'spawn' | 'group'; name: string; chance: number; at: { x: number; y: number; z: number } | null }[];
}

/** A member to take out of the group it is in when a group is saved: a spawn, or a quest leaving its rotation */
export type GroupMove = { kind: 'npc' | 'object'; guid: number } | { kind: 'quest'; questId: number };

/** A quest pool (rotation) in the database: its quests, how many are offered each reset, and whether they are daily (else weekly). */
export interface QuestPoolSummary {
  id: number;
  name: string;
  maxActive: number;
  daily: boolean;
  questIds: number[];
}

/** A spawn group check: the reasons it cannot be saved, and notes that do not block it */
export interface GroupCheck {
  reasons: string[];
  notes: string[];
}

/** Spawn groups and quest rotations: reading, checking, saving and deleting them */
export interface SpawnGroupsApi {
  /** A spawn group as the layer has it, else as the database's pool; null when there is none. */
  worldGroup(id: number): Promise<Result<SpawnGroup | null>>;
  /** Every spawn under a group through all its levels (the layer's copy of each group, else the database's), by kind and guid. */
  worldGroupSpawns(id: number): Promise<Result<{ kind: 'npc' | 'object'; guid: number }[]>>;
  /** A spawn group described for the view: its members by name and where they stand. */
  worldGroupView(id: number): Promise<Result<GroupView | null>>;
  /** The spawn groups on a map (the database's and the layer's), by name. */
  worldGroupsOnMap(map: number): Promise<Result<{ id: number; name: string; maxActive: number; members: number; groups: number[] }[]>>;
  /** An id no spawn group uses yet. */
  worldNewGroupId(): Promise<Result<number>>;
  /**
   * Why the server would refuse or misread a group, or a group its `moves` (spawns the save takes out of
   * their group) leave; none when it is fine. Notes name left groups the save empties and deletes.
   */
  worldCheckGroup(group: SpawnGroup, moves: GroupMove[]): Promise<Result<GroupCheck>>;
  /** Saves a spawn group in the world layer as one step, moving `moves` out of the group they were in; refused with why when it is not valid. */
  worldSetGroup(group: SpawnGroup, moves: GroupMove[]): Promise<Result<WorldLayer>>;
  /** Deletes a spawn group: a new one is forgotten, an existing one is removed on export. */
  worldDeleteGroup(id: number): Promise<Result<WorldLayer>>;
  /** Takes a spawn out of every group in the world layer. */
  worldDropMember(kind: 'npc' | 'object', guid: number): Promise<Result<WorldLayer>>;
  /** Every quest pool (rotation) in the database with its member quests, and whether its quests are daily. */
  questPools(): Promise<Result<QuestPoolSummary[]>>;
}
