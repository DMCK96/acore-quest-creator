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
export type EntityLock = 'type' | 'loot' | 'fight' | 'trainer';
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
    // How many other NPCs use its trainer; absent in projects saved before trainers
    sharedTrainer: int.min(0).optional(),
    // How many other creatures and objects use each menu of its gossip tree, and how many outside menus use each text (by id)
    sharedMenus: z.record(z.string(), int.min(0)).optional(),
    sharedTexts: z.record(z.string(), int.min(0)).optional(),
    locked: z.array(z.enum(['type', 'loot', 'fight', 'trainer'])),
  }),
]);
const NEW_ORIGIN = { kind: 'new' } as const;

/** One thing an NPC sells: `maxCount` 0 is unlimited, and `extendedCost` 0 is gold alone */
export const vendorItemSchema = z.object({
  // Negative: a reference to another vendor's whole list (the server reads `-item` as an NPC entry)
  item: int,
  // `npc_vendor.maxcount` is a tinyint unsigned
  maxCount: int.min(0).max(255),
  restockSecs: int.min(0),
  extendedCost: int.min(0),
});

/** `trainer.Type`: what a trainer teaches */
export const TRAINER_TYPES = ['class', 'mount', 'profession', 'pet'] as const;
export const TRAINER_TYPE_VALUE = { class: 0, mount: 1, profession: 2, pet: 3 } as const;

/** One spell a trainer teaches: its price in copper, the level and skill a player needs, and up to three spells to know first */
export const trainerSpellSchema = z.object({
  // 0: not picked yet
  spell: int.min(0),
  cost: int.min(0),
  reqLevel: int.min(0).max(255),
  reqSkill: int.min(0),
  reqSkillRank: int.min(0),
  reqSpells: z.array(int.positive()).max(3),
});

/** What an NPC teaches: its own trainer row (`trainerId`) and the spells under it. `requirement` is the class a class trainer serves, else 0 */
export const trainerSchema = z.object({
  trainerId: int,
  type: z.enum(TRAINER_TYPES),
  requirement: int.min(0),
  greeting: z.string(),
  spells: z.array(trainerSpellSchema),
});

/** What an option does: closes the window, opens another menu, or opens a service window (a named type and NPC flag pair) */
export const gossipActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('close') }),
  z.object({ kind: z.literal('menu'), menuId: int.positive() }),
  z.object({ kind: z.literal('service'), type: int.min(0), npcFlag: int.min(0) }),
]);

/** One line a menu may greet with; the variants are chosen by weight */
export const textVariantSchema = z.object({ text: z.string(), textFemale: z.string(), probability: num.min(0) });

/**
 * One option of a menu. `optionId` is pinned (conditions and scripts name it). `kept` marks an option the
 * database ties to a condition or a script: it cannot be removed and its action cannot change.
 */
export const gossipOptionSchema = z.object({ optionId: int.min(0), icon: int.min(0), text: z.string(), action: gossipActionSchema, kept: z.boolean() });

/** A menu with its greeting. `locked` menus (shared, or ones the editor cannot model) are never written */
export const gossipMenuSchema = z.object({
  menuId: int,
  textId: int,
  greeting: z.array(textVariantSchema).min(1).max(8),
  options: z.array(gossipOptionSchema),
  locked: z.boolean(),
});

/** An NPC's menus: the first is the one it opens with (`creature_template.gossip_menu_id`) */
export const gossipTreeSchema = z.object({ menus: z.array(gossipMenuSchema).min(1) });

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
  // Added with NPC vendors; what it sells, in display order (the index is the slot). The default keeps NPCs saved before then as they were.
  vendor: z.array(vendorItemSchema).default([]),
  // Added with NPC trainers; null is not a trainer. The default keeps NPCs saved before then as they were.
  trainer: trainerSchema.nullable().default(null),
  // Added with NPC gossip; null has no menu (`gossip` is the Can be talked to flag). The default keeps NPCs saved before then as they were.
  gossipMenu: gossipTreeSchema.nullable().default(null),
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
export type VendorItem = z.infer<typeof vendorItemSchema>;
export type TrainerSpell = z.infer<typeof trainerSpellSchema>;
export type Trainer = z.infer<typeof trainerSchema>;
export type GossipAction = z.infer<typeof gossipActionSchema>;
export type TextVariant = z.infer<typeof textVariantSchema>;
export type GossipOption = z.infer<typeof gossipOptionSchema>;
export type GossipMenu = z.infer<typeof gossipMenuSchema>;
export type GossipTree = z.infer<typeof gossipTreeSchema>;
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

/**
 * Whether an existing NPC's stock was never read: a project saved before vendors existed, or a fork
 * without `npc_vendor`. Its stock is then not ours to write, whatever `vendor` holds.
 */
export function vendorUnread(npc: { origin: StoredOrigin }): boolean {
  return npc.origin.kind === 'existing' && !Object.prototype.hasOwnProperty.call(npc.origin.original, 'npc_vendor');
}

/** Whether two stock lists hold the same rows in the same order */
export function sameVendor(a: readonly VendorItem[], b: readonly VendorItem[]): boolean {
  return a.length === b.length && a.every((x, i) => x.item === b[i]!.item && x.maxCount === b[i]!.maxCount && x.restockSecs === b[i]!.restockSecs && x.extendedCost === b[i]!.extendedCost);
}

/**
 * Whether an existing NPC's trainer was never read: a project saved before trainers existed, or a fork
 * without the trainer tables. Its trainer is then not ours to write, whatever `trainer` holds.
 */
export function trainerUnread(npc: { origin: StoredOrigin }): boolean {
  return npc.origin.kind === 'existing' && !Object.prototype.hasOwnProperty.call(npc.origin.original, 'creature_default_trainer');
}

/** Whether two trainers hold the same values, spells in the same order */
export function sameTrainer(a: Trainer | null, b: Trainer | null): boolean {
  if (a === null || b === null) return a === b;
  const same = (x: readonly number[], y: readonly number[]): boolean => x.length === y.length && x.every((v, i) => v === y[i]);
  return (
    a.trainerId === b.trainerId && a.type === b.type && a.requirement === b.requirement && a.greeting === b.greeting && a.spells.length === b.spells.length &&
    a.spells.every((s, i) => {
      const t = b.spells[i]!;
      return s.spell === t.spell && s.cost === t.cost && s.reqLevel === t.reqLevel && s.reqSkill === t.reqSkill && s.reqSkillRank === t.reqSkillRank && same(s.reqSpells, t.reqSpells);
    })
  );
}

/**
 * Whether an existing NPC's gossip was never read: a project saved before gossip existed, or a fork without
 * the gossip tables. Its gossip is then not ours to write, whatever `gossipMenu` holds.
 */
export function gossipUnread(npc: { origin: StoredOrigin }): boolean {
  return npc.origin.kind === 'existing' && !Object.prototype.hasOwnProperty.call(npc.origin.original, 'gossip_menu');
}

/** Whether two options hold the same values */
export function sameGossipOption(o: GossipOption, p: GossipOption): boolean {
  const x = o.action;
  const y = p.action;
  const sameAction = x.kind === y.kind && (x.kind !== 'menu' || x.menuId === (y as typeof x).menuId) && (x.kind !== 'service' || (x.type === (y as typeof x).type && x.npcFlag === (y as typeof x).npcFlag));
  return o.optionId === p.optionId && o.icon === p.icon && o.text === p.text && o.kept === p.kept && sameAction;
}

/** Whether two menus hold the same values; `locked` says nothing of what they hold */
export function sameGossipMenu(a: GossipMenu, b: GossipMenu): boolean {
  return (
    a.menuId === b.menuId && a.textId === b.textId &&
    a.greeting.length === b.greeting.length && a.greeting.every((v, i) => v.text === b.greeting[i]!.text && v.textFemale === b.greeting[i]!.textFemale && v.probability === b.greeting[i]!.probability) &&
    a.options.length === b.options.length && a.options.every((o, i) => sameGossipOption(o, b.options[i]!))
  );
}

/** Whether two trees hold the same menus in the same order */
export function sameGossip(a: GossipTree | null, b: GossipTree | null): boolean {
  if (a === null || b === null) return a === b;
  return a.menus.length === b.menus.length && a.menus.every((m, i) => sameGossipMenu(m, b.menus[i]!));
}

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
    vendor: [],
    trainer: null,
    gossipMenu: null,
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
