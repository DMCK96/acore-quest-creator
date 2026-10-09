import type { ProjectEntities, CustomItem, CustomNpc, CustomObject } from '@core/entities/model';
import type { QuestAggregate } from '@core/model/aggregate';
import type { EntityRef } from '@core/entities/entity';
import type { ColumnInfo } from '@core/db/types';
import type { Result } from './result';

export type AllocKind = 'creature' | 'gameobject' | 'creatureSpawn' | 'gameobjectSpawn' | 'page' | 'item';

/** Fields an existing NPC or object lends a new one. */
export type EntityTemplate =
  | Partial<Omit<CustomNpc, 'entry' | 'spawns'>>
  | Partial<Omit<CustomObject, 'entry' | 'spawns'>>
  | Pick<CustomItem, 'name' | 'displayId' | 'itemClass' | 'subclass' | 'inventoryType' | 'buyPrice'>;

/** The project's NPCs, objects and items: ids for new ones, templates to start from, and editing existing ones */
export interface EntitiesApi {
  /** Fresh IDs for new NPCs, objects or their spawns: above the database and every quest in the project. */
  allocateIds(kind: AllocKind, count: number): Promise<Result<number[]>>;
  /** The look and stats of an existing NPC or object, to start a new one from; null when there is none. */
  entityTemplate(kind: 'creature' | 'gameobject' | 'item', entry: number): Promise<Result<EntityTemplate | null>>;
  /** The `item_template` columns the export database has, for the item editor's advanced fields; none when unknown. */
  itemColumns(): Promise<Result<ColumnInfo[]>>;
  /** The project's new NPCs, objects and items. */
  projectEntities(): Promise<Result<ProjectEntities>>;
  /** Replaces the project's new NPCs, objects and items: one undo step (typing in one merges). */
  putProjectEntities(next: ProjectEntities): Promise<Result<true>>;
  /** An existing NPC, object or item as the database has it, to adopt into the project */
  readExistingEntity(kind: 'npc' | 'object' | 'item', entry: number): Promise<Result<CustomNpc | CustomObject | CustomItem>>;
  existingDrift(): Promise<Result<EntityRef[]>>;
  /**
   * Deletes one of the project's NPCs, objects or items and empties every quest's giver card that named
   * it, as one undo step; gives the store and the quests it changed, as they now are.
   */
  deleteEntity(kind: 'npc' | 'object' | 'item', entry: number): Promise<Result<{ entities: ProjectEntities; quests: { questId: number; aggregate: QuestAggregate }[] }>>;
}
