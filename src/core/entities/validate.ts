import { fightIssues } from '../combat/validate';
import type { Issue } from '../validate/validate';
import { ENTITIES_FIELD, type CustomItem, type CustomNpc, type CustomObject, type QuestEntities } from './model';
import { missingChoice } from '../patrol/compile';

/**
 * Inventory types the server lets an NPC hold (`ObjectMgr::LoadEquipmentTemplates`): weapon, shield,
 * ranged, two-hand, main hand, off hand, held in off hand, thrown, wand/gun. Anything else it drops.
 */
const HELD_IN_HAND: ReadonlySet<number> = new Set([13, 14, 15, 17, 21, 22, 23, 25, 26]);

const NUMERIC_TYPES: ReadonlySet<string> = new Set(['tinyint', 'smallint', 'mediumint', 'int', 'bigint', 'float', 'double', 'decimal']);
const NUMBER = /^-?\d+(\.\d+)?$/;
/** `ItemClass` Quest: something the player carries for a quest, never worn. */
const QUEST_CLASS = 12;

/** What is wrong with the quest's new NPCs, objects and items, each issue routed to their module. */
export function entityIssues(input: {
  entities: QuestEntities;
  dbNames: ReadonlyMap<string, string>;
  questItems?: readonly number[];
  /** Whether a spell is in the server's spell list; null when the list is not loaded. */
  knownSpell?: ((id: number) => boolean) | null;
  /** `RequiredNpcOrGo`, for fights that give quest credit. */
  objectives?: readonly number[];
  /** `item_template.InventoryType` of the items NPCs hold, when read; null skips the weapon check. */
  itemInventoryTypes?: ReadonlyMap<number, number> | null;
  /** Whether a quest is in the world or the project; null skips the check of items that start one. */
  knownQuest?: ((id: number) => boolean) | null;
  /** `item_template` column name to its data type; null skips the check of advanced values. */
  itemColumnTypes?: ReadonlyMap<string, string> | null;
}): Issue[] {
  const questItems = new Set(input.questItems ?? []);
  const issues: Issue[] = [];
  const check = (kind: 'creature' | 'gameobject', entity: CustomNpc | CustomObject): void => {
    const word = kind === 'creature' ? 'NPC' : 'Object';
    const label = entity.name.trim() ? `${word} "${entity.name.trim()}"` : `${word} ${entity.entry}`;
    const add = (severity: Issue['severity'], code: string, message: string): void => {
      issues.push({ severity, code, fieldId: ENTITIES_FIELD, message: `${label}: ${message}` });
    };
    if (entity.name.trim() === '') add('error', 'ENTITY_NO_NAME', 'give it a name.');
    if (entity.displayId <= 0) add('error', 'ENTITY_NO_MODEL', 'choose its model, or copy it from an existing one.');
    if ('minLevel' in entity && (entity.minLevel < 1 || entity.minLevel > entity.maxLevel)) {
      add('error', 'ENTITY_LEVELS', 'its minimum level must be at least 1 and no higher than its maximum.');
    }
    if (entity.spawns.length === 0) add('warning', 'ENTITY_NO_SPAWN', 'nothing places it in the world yet; add a spawn.');
    else if (entity.spawns.some((s) => s.x === 0 && s.y === 0 && s.z === 0)) {
      add('warning', 'ENTITY_SPAWN_ORIGIN', 'a spawn is still at 0, 0, 0; set where it stands.');
    }
    if ('equipment' in entity && input.itemInventoryTypes) {
      for (const [slot, word] of [['mainHand', 'main hand'], ['offHand', 'off hand'], ['ranged', 'ranged']] as const) {
        const item = entity.equipment[slot];
        if (item <= 0) continue;
        const type = input.itemInventoryTypes.get(item);
        if (type === undefined) add('warning', 'ENTITY_WEAPON', `the ${word} item ${item} is not in the world database.`);
        else if (!HELD_IN_HAND.has(type)) add('warning', 'ENTITY_WEAPON', `the ${word} item ${item} is not held in a hand, so it would not show.`);
      }
    }
    if ('fight' in entity) {
      for (const spawn of entity.spawns) {
        spawn.patrol?.points.forEach((point, i) => {
          for (const action of point.actions) {
            const missing = missingChoice(action);
            if (missing) add('warning', 'PATROL_UNPICKED', `at patrol point ${i + 1}, ${missing}.`);
          }
        });
      }
    }
    if ('pages' in entity) {
      if (entity.type === 'text' && entity.pages.length === 0) add('error', 'ENTITY_NO_PAGES', 'a readable object needs at least one page.');
      if (entity.pages.some((p) => p.text.trim() === '')) add('warning', 'ENTITY_EMPTY_PAGE', 'a page has no text.');
    }
    if ('pages' in entity && entity.type === 'chest' && entity.loot.length === 0) add('warning', 'LOOT_EMPTY_CHEST', 'the chest has nothing in it; add loot.');
    for (const row of entity.loot) {
      if (row.item <= 0) add('error', 'LOOT_NO_ITEM', 'a loot row has no item.');
      else if (questItems.has(row.item)) add('warning', 'LOOT_QUEST_ITEM', `item ${row.item} is one this quest asks for; set where it drops in Objectives.`);
      if (row.chance < 0 || row.chance > 100) add('error', 'LOOT_CHANCE', 'a drop chance must be between 0 and 100%.');
      if (row.min < 1 || row.min > row.max) add('error', 'LOOT_COUNT', 'the least dropped must be at least 1 and no more than the most.');
    }
    if ('fight' in entity && entity.fight) issues.push(...fightIssues(entity.fight, label, input.knownSpell ?? null, input.objectives ?? null));
    const existing = input.dbNames.get(`${kind}:${entity.entry}`);
    if (existing !== undefined && existing !== entity.name) {
      add('warning', 'ENTITY_TAKEN', `entry ${entity.entry} already holds "${existing}" in the database, which this would replace.`);
    }
  };
  const checkItem = (item: CustomItem): void => {
    const label = item.name.trim() ? `Item "${item.name.trim()}"` : `Item ${item.entry}`;
    const add = (severity: Issue['severity'], code: string, message: string): void => {
      issues.push({ severity, code, fieldId: ENTITIES_FIELD, message: `${label}: ${message}` });
    };
    if (item.name.trim() === '') add('error', 'ITEM_NO_NAME', 'give it a name.');
    if (item.stackable < 1) add('error', 'ITEM_STACK', 'the stack size must be at least 1.');
    if (item.requiredLevel < 0 || item.itemLevel < 0) add('error', 'ITEM_LEVELS', 'the item and required levels cannot be negative.');
    if (item.stats.some((s) => s.type === 0)) add('error', 'ITEM_EMPTY_STAT', 'a stat row has no stat picked.');
    if (item.damage.some((d) => d.max === 0 || d.min > d.max)) add('error', 'ITEM_EMPTY_DAMAGE', 'a damage row has no damage.');
    if (item.spells.some((s) => s.spell === 0)) add('error', 'ITEM_EMPTY_SPELL', 'a spell row has no spell.');
    if (item.displayId <= 0) add('warning', 'ITEM_NO_LOOK', 'it has no look, so it shows as a question mark; choose a display ID.');
    if (item.inventoryType > 0 && item.itemClass === QUEST_CLASS) {
      add('warning', 'ITEM_QUEST_EQUIP', 'it can be equipped but its class is Quest; pick the class it should be.');
    }
    if (item.startsQuest > 0 && input.knownQuest && !input.knownQuest(item.startsQuest)) {
      add('warning', 'ITEM_STARTS_UNKNOWN', `it starts quest ${item.startsQuest}, which is neither in the world database nor in this project.`);
    }
    if (item.pages.some((p) => p.text.trim() === '')) add('warning', 'ITEM_EMPTY_PAGE', 'a page has no text.');
    if (input.itemColumnTypes) {
      for (const [column, value] of Object.entries(item.advanced)) {
        const type = input.itemColumnTypes.get(column);
        if (type !== undefined && NUMERIC_TYPES.has(type) && !NUMBER.test(value.trim())) {
          add('error', 'ITEM_ADVANCED_TYPE', `${column} must be a number, not "${value}".`);
        }
      }
    }
    const existing = input.dbNames.get(`item:${item.entry}`);
    if (existing !== undefined && existing !== item.name) {
      add('warning', 'ENTITY_TAKEN', `entry ${item.entry} already holds "${existing}" in the database, which this would replace.`);
    }
  };
  for (const npc of input.entities.npcs) check('creature', npc);
  for (const object of input.entities.objects) check('gameobject', object);
  for (const item of input.entities.items ?? []) checkItem(item);
  return issues;
}
