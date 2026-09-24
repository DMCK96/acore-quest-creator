import type { Issue } from '../validate/validate';
import { ENTITIES_FIELD, type CustomNpc, type CustomObject, type QuestEntities } from './model';

/** What is wrong with the quest's new NPCs and objects, each issue routed to their module. */
export function entityIssues(input: { entities: QuestEntities; dbNames: ReadonlyMap<string, string>; questItems?: readonly number[] }): Issue[] {
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
    const existing = input.dbNames.get(`${kind}:${entity.entry}`);
    if (existing !== undefined && existing !== entity.name) {
      add('warning', 'ENTITY_TAKEN', `entry ${entity.entry} already holds "${existing}" in the database, which this would replace.`);
    }
  };
  for (const npc of input.entities.npcs) check('creature', npc);
  for (const object of input.entities.objects) check('gameobject', object);
  return issues;
}
