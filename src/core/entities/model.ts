import { z } from 'zod';
import type { FieldValue } from '../registry/types';
import { fightSchema } from '../combat/model';
import type { EntityOrigin } from './entity';

/**
 * New NPCs and objects a quest needs, and where they stand. Stored in the quest's values under
 * `ENTITIES_FIELD` and compiled into template and spawn rows at export (`compile.ts`). Entries and
 * guids are allocated once, when the author creates them, and stay pinned here.
 */

export const ENTITIES_FIELD = 'entities';

const int = z.number().int();
const num = z.number().finite();

const PACES = ['walk', 'run'] as const;
const action = <K extends string, T extends z.ZodRawShape>(kind: K, shape: T) =>
  z.object({ id: z.string(), afterSecs: num.min(0), kind: z.literal(kind), ...shape });

/** What a patrolling NPC does on reaching a point of its route, each `afterSecs` after arriving. */
const pointActionSchema = z.discriminatedUnion('kind', [
  action('say', {
    lines: z.array(z.object({ text: z.string(), style: z.enum(['say', 'yell', 'emote']) })),
    chance: num.min(0).max(100),
  }),
  action('emote', { emote: int }),
  // An emote state held while it waits (kneel, mining, …), undone before it walks on.
  action('pose', { emoteState: int }),
  action('cast', { spell: int }),
  action('sound', { sound: int }),
  action('mount', { creature: int }),
  action('dismount', {}),
  action('useObject', { guid: int, entry: int }),
]);

const patrolPointSchema = z.object({
  x: num,
  y: num,
  z: num,
  waitSecs: num.min(0),
  /** Radians; null leaves it facing the way it walked in. */
  facing: num.nullable(),
  /** The pace from this point on; null keeps the pace it had. */
  paceFromHere: z.enum(PACES).nullable(),
  actions: z.array(pointActionSchema).default([]),
});

/** A route a new NPC's spawn walks forever, looping back to where it stands. */
export const patrolSchema = z.object({
  /** The `waypoint_data` path, allocated once and pinned like a guid. */
  pathId: int,
  startPace: z.enum(PACES),
  points: z.array(patrolPointSchema),
});

/** Who sees an NPC: the living (the default), only the dead (a spirit healer), or both */
export const SEEN_BY = ['living', 'dead', 'both'] as const;
export type SeenBy = (typeof SEEN_BY)[number];

/**
 * The game events a spawn follows: in the world only during any of them, or gone during any of them;
 * null when it is always in the world. A spawn's `game_event_creature` rows, one per event.
 */
export const eventRuleSchema = z
  .object({
    mode: z.enum(['during', 'except']),
    // Each event once, in order: the rows are one per event, and a rule compares by its list
    events: z.array(int.positive()).min(1).transform((ids) => [...new Set(ids)].sort((a, b) => a - b)),
  })
  .nullable();
export type EventRule = z.infer<typeof eventRuleSchema>;
/** An NPC's rule for its spawns; 'asIs' leaves each spawn's events as the database has them */
export type NpcEvents = EventRule | 'asIs';
/** A spawn's own rule; 'npc' follows its NPC's */
export type SpawnEvents = EventRule | 'npc';

const spawnSchema = z.object({
  guid: int,
  map: int,
  x: num,
  y: num,
  z: num,
  o: num,
  respawnSecs: int.min(0),
  wander: num.min(0),
  // Added with patrols (slice L); null keeps spawns saved before then as they were.
  patrol: patrolSchema.nullable().default(null),
  // An object's whole rotation (x, y, z, w), set when it is tilted in the 3D view; null turns it by `o` alone
  rotation: z.tuple([num, num, num, num]).nullable().default(null),
  // Added with NPC visibility; 'npc' keeps spawns saved before then following their NPC
  events: z.union([eventRuleSchema, z.literal('npc')]).default('npc'),
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

/** What of an existing entity the project may not change, because other things share it */
export type EntityLock = 'type' | 'loot' | 'fight';
/** An existing entity's rows as the database had them, by table name */
export type OriginalRows = Record<string, Record<string, string | null>[]>;

/**
 * Where a stored entity came from: made in the project, or an existing one edited here, with its
 * rows as the database had them (put back on revert), how many other entries share its loot, how
 * many spawns it has and what may not be changed.
 */
const originSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('new') }),
  z.object({
    kind: z.literal('existing'),
    original: z.record(z.string(), z.array(z.record(z.string(), z.string().nullable()))),
    sharedLoot: int.min(0),
    spawnCount: int.min(0),
    locked: z.array(z.enum(['type', 'loot', 'fight'])),
  }),
]);
const NEW_ORIGIN = { kind: 'new' } as const;

export const lootSchema = z.object({ item: int, chance: num, min: int, max: int, questOnly: z.boolean() });

const npcFields = z.object({
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
  // Added with loot (slice H); the default keeps NPCs saved before then as they were.
  loot: z.array(lootSchema).default([]),
  // Added with fights (slice I); null keeps NPCs saved before then as they were.
  fight: fightSchema.nullable().default(null),
  // Added with the NPC editor (slice M): the weapons it holds, as items; none keeps older NPCs unarmed.
  equipment: z.object({ mainHand: int, offHand: int, ranged: int }).default({ mainHand: 0, offHand: 0, ranged: 0 }),
  // Added with editing existing entities; anything saved before then was made in the project.
  origin: originSchema.default(NEW_ORIGIN),
  // Added with NPC visibility. Absent: who sees it is as the database has it
  seenBy: z.enum(SEEN_BY).optional(),
  // Added with NPC visibility; 'asIs' leaves every spawn's events as they are
  events: z.union([eventRuleSchema, z.literal('asIs')]).default('asIs'),
});

/**
 * An NPC saved before visibility existed has no rule: a new one never wrote any event rows, so it is
 * always in the world; an existing one leaves its spawns' rows as they are.
 */
const npcSchema = z.preprocess((raw) => {
  if (typeof raw !== 'object' || raw === null || 'events' in raw) return raw;
  const origin = (raw as { origin?: { kind?: unknown } }).origin;
  return origin?.kind === 'existing' ? raw : { ...raw, events: null };
}, npcFields);

const pageSchema = z.object({ id: int, text: z.string() });

const objectSchema = z.object({
  entry: int,
  name: z.string(),
  type: z.enum(keysOf(OBJECT_TYPE_VALUE)),
  displayId: int,
  size: num,
  spawns: z.array(spawnSchema),
  // Added with readable objects (slice E); defaults keep objects saved before then as they were.
  pages: z.array(pageSchema).default([]),
  // The quest a player must have in their log to use or loot it, or null for anyone.
  onlyDuringQuest: int.nullable().default(null),
  loot: z.array(lootSchema).default([]),
  origin: originSchema.default(NEW_ORIGIN),
});

export const ITEM_QUALITY_VALUE = { poor: 0, common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5, artifact: 6, heirloom: 7 } as const;
export const BONDING_VALUE = { none: 0, pickup: 1, equip: 2, use: 3, quest: 4 } as const;

const itemStatSchema = z.object({ type: int, value: int });
const itemDamageSchema = z.object({ min: num, max: num, school: int });
const itemSpellSchema = z.object({ spell: int, trigger: int, charges: int, cooldownMs: int, category: int, categoryCooldownMs: int });

/**
 * A new item the quest needs (added with items): the columns quests and rewards use as typed
 * fields, and any other `item_template` column as raw text in `advanced`, so an imported item keeps
 * everything it came with. The caps are the slots `item_template` has.
 */
const itemSchema = z.object({
  entry: int,
  name: z.string(),
  description: z.string(),
  quality: z.enum(keysOf(ITEM_QUALITY_VALUE)),
  itemClass: int,
  subclass: int,
  inventoryType: int,
  displayId: int,
  itemLevel: int,
  requiredLevel: int,
  stackable: int,
  maxCount: int,
  bonding: z.enum(keysOf(BONDING_VALUE)),
  buyPrice: int,
  sellPrice: int,
  startsQuest: int,
  pages: z.array(pageSchema),
  armor: int,
  damage: z.array(itemDamageSchema).max(2),
  delayMs: int,
  stats: z.array(itemStatSchema).max(10),
  spells: z.array(itemSpellSchema).max(5),
  advanced: z.record(z.string(), z.string()),
  origin: originSchema.default(NEW_ORIGIN),
});

export type StoredOrigin = z.infer<typeof originSchema>;
export type Spawn = z.infer<typeof spawnSchema>;
export type Pace = (typeof PACES)[number];
export type PointAction = z.infer<typeof pointActionSchema>;
export type SayLine = Extract<PointAction, { kind: 'say' }>['lines'][number];
export type PatrolPoint = z.infer<typeof patrolPointSchema>;
export type Patrol = z.infer<typeof patrolSchema>;
export type Page = z.infer<typeof pageSchema>;
export type LootRow = z.infer<typeof lootSchema>;
export type CustomNpc = z.infer<typeof npcSchema>;
export type CustomObject = z.infer<typeof objectSchema>;
export type NpcRank = CustomNpc['rank'];
export type NpcType = CustomNpc['type'];
export type ObjectType = CustomObject['type'];
export type CustomItem = z.infer<typeof itemSchema>;
export type ItemStat = z.infer<typeof itemStatSchema>;
export type ItemDamage = z.infer<typeof itemDamageSchema>;
export type ItemSpell = z.infer<typeof itemSpellSchema>;
export type ItemQuality = CustomItem['quality'];
export type Bonding = CustomItem['bonding'];

/** The project's new NPCs, objects and items: one store; a quest uses one by naming it. */
export interface ProjectEntities {
  npcs: CustomNpc[];
  objects: CustomObject[];
  items: CustomItem[];
}

export type QuestEntities = ProjectEntities;

export const EMPTY_ENTITIES: ProjectEntities = { npcs: [], objects: [], items: [] };

/** The schema a whole store is checked against when the window sends it. */
export const projectEntitiesSchema = z.object({ npcs: z.array(npcSchema), objects: z.array(objectSchema), items: z.array(itemSchema) });

/** Whether a stored entity was made in the project or is an existing one edited here */
export function originOf(entity: { origin: StoredOrigin }): EntityOrigin {
  return entity.origin.kind;
}

const byOrigin = (store: ProjectEntities, kind: EntityOrigin): ProjectEntities => ({
  npcs: store.npcs.filter((n) => n.origin.kind === kind),
  objects: store.objects.filter((o) => o.origin.kind === kind),
  items: store.items.filter((i) => i.origin.kind === kind),
});

/** The store's entities made in the project */
export function newOnly(store: ProjectEntities): ProjectEntities {
  return byOrigin(store, 'new');
}

/** The store's existing entities edited here */
export function existingOnly(store: ProjectEntities): ProjectEntities {
  return byOrigin(store, 'existing');
}

const validItems = <T>(schema: z.ZodType<T>, raw: unknown): T[] =>
  Array.isArray(raw)
    ? raw.flatMap((item) => {
        const parsed = schema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      })
    : [];

/** The project's store; anything not valid is left out, never thrown. */
export function readProjectEntities(raw: unknown): ProjectEntities {
  const record = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return { npcs: validItems(npcSchema, record.npcs), objects: validItems(objectSchema, record.objects), items: validItems(itemSchema, record.items) };
}

/** A quest's new NPCs, objects and items as projects before version 4 kept them; read only to move them. */
export function readEntities(values: Readonly<Record<string, unknown>>): QuestEntities {
  const raw = values[ENTITIES_FIELD];
  const record = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return { npcs: validItems(npcSchema, record.npcs), objects: validItems(objectSchema, record.objects), items: validItems(itemSchema, record.items) };
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
    loot: [],
    fight: null,
    equipment: { mainHand: 0, offHand: 0, ranged: 0 },
    origin: { kind: 'new' },
    seenBy: 'living',
    events: null,
  };
}

export function newObject(entry: number): CustomObject {
  return { entry, name: '', type: 'goober', displayId: 0, size: 1, spawns: [], pages: [], onlyDuringQuest: null, loot: [], origin: { kind: 'new' } };
}

export function newSpawn(guid: number): Spawn {
  return { guid, map: 0, x: 0, y: 0, z: 0, o: 0, respawnSecs: 300, wander: 0, patrol: null, rotation: null, events: 'npc' };
}

/** A new item starts as a quest item: most are things the player is asked to collect. */
export function newItem(entry: number): CustomItem {
  return {
    entry, name: '', description: '', quality: 'common', itemClass: 12, subclass: 0, inventoryType: 0, displayId: 0,
    itemLevel: 1, requiredLevel: 0, stackable: 1, maxCount: 1, bonding: 'quest', buyPrice: 0, sellPrice: 0, startsQuest: 0,
    pages: [], armor: 0, damage: [], delayMs: 0, stats: [], spells: [], advanced: {}, origin: { kind: 'new' },
  };
}
