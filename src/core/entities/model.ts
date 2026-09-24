import { z } from 'zod';
import type { FieldValue } from '../registry/types';

/**
 * New NPCs and objects a quest needs, and where they stand. Stored in the quest's values under
 * `ENTITIES_FIELD` and compiled into template and spawn rows at export (`compile.ts`). Entries and
 * guids are allocated once, when the author creates them, and stay pinned here.
 */

export const ENTITIES_FIELD = 'entities';

const int = z.number().int();
const num = z.number().finite();

const spawnSchema = z.object({
  guid: int,
  map: int,
  x: num,
  y: num,
  z: num,
  o: num,
  respawnSecs: int.min(0),
  wander: num.min(0),
});

export const RANK_VALUE = { normal: 0, elite: 1, rareElite: 2, boss: 3, rare: 4 } as const;
export const NPC_TYPE_VALUE = {
  beast: 1,
  dragonkin: 2,
  demon: 3,
  elemental: 4,
  giant: 5,
  undead: 6,
  humanoid: 7,
  critter: 8,
  mechanical: 9,
  none: 10,
} as const;
export const OBJECT_TYPE_VALUE = { questGiver: 2, chest: 3, generic: 5, text: 9, goober: 10 } as const;

const keysOf = <T extends Record<string, number>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];

const npcSchema = z.object({
  entry: int,
  name: z.string(),
  subname: z.string(),
  minLevel: int,
  maxLevel: int,
  faction: int,
  displayId: int,
  scale: num,
  rank: z.enum(keysOf(RANK_VALUE)),
  type: z.enum(keysOf(NPC_TYPE_VALUE)),
  questGiver: z.boolean(),
  gossip: z.boolean(),
  healthModifier: num,
  damageModifier: num,
  spawns: z.array(spawnSchema),
});

const objectSchema = z.object({
  entry: int,
  name: z.string(),
  type: z.enum(keysOf(OBJECT_TYPE_VALUE)),
  displayId: int,
  size: num,
  spawns: z.array(spawnSchema),
});

export type Spawn = z.infer<typeof spawnSchema>;
export type CustomNpc = z.infer<typeof npcSchema>;
export type CustomObject = z.infer<typeof objectSchema>;
export type NpcRank = CustomNpc['rank'];
export type NpcType = CustomNpc['type'];
export type ObjectType = CustomObject['type'];

export interface QuestEntities {
  npcs: CustomNpc[];
  objects: CustomObject[];
}

const validItems = <T>(schema: z.ZodType<T>, raw: unknown): T[] =>
  Array.isArray(raw)
    ? raw.flatMap((item) => {
        const parsed = schema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      })
    : [];

/** The quest's new NPCs and objects; anything not valid is left out, never thrown. */
export function readEntities(values: Readonly<Record<string, unknown>>): QuestEntities {
  const raw = values[ENTITIES_FIELD];
  const record = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return { npcs: validItems(npcSchema, record.npcs), objects: validItems(objectSchema, record.objects) };
}

/** Entities in the shape the values map carries; like scenes, nested data no column models. */
export function writeEntities(entities: QuestEntities): FieldValue {
  return entities as unknown as FieldValue;
}

export function newNpc(entry: number): CustomNpc {
  return {
    entry,
    name: '',
    subname: '',
    minLevel: 1,
    maxLevel: 1,
    faction: 35,
    displayId: 0,
    scale: 1,
    rank: 'normal',
    type: 'humanoid',
    questGiver: false,
    gossip: false,
    healthModifier: 1,
    damageModifier: 1,
    spawns: [],
  };
}

export function newObject(entry: number): CustomObject {
  return { entry, name: '', type: 'goober', displayId: 0, size: 1, spawns: [] };
}

export function newSpawn(guid: number): Spawn {
  return { guid, map: 0, x: 0, y: 0, z: 0, o: 0, respawnSecs: 300, wander: 0 };
}
