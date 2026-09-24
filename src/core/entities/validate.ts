import type { Issue } from '../validate/validate';
import { ENTITIES_FIELD, type CustomNpc, type CustomObject, type QuestEntities } from './model';

/** What is wrong with the quest's new NPCs and objects, each issue routed to their module. */
export function entityIssues(input: { entities: QuestEntities; dbNames: ReadonlyMap<string, string> }): Issue[] {
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
    const existing = input.dbNames.get(`${kind}:${entity.entry}`);
    if (existing !== undefined && existing !== entity.name) {
      add('warning', 'ENTITY_TAKEN', `entry ${entity.entry} already holds "${existing}" in the database, which this would replace.`);
    }
  };
  for (const npc of input.entities.npcs) check('creature', npc);
  for (const object of input.entities.objects) check('gameobject', object);
  return issues;
}
