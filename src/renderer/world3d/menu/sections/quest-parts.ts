import { hasRole, type RoleTarget } from '@core/modules/quest-roles';
import { item, type MenuContext, type MenuItem } from '../model';
import { OBJECTIVES_FULL, type MenuSection } from '../section';
import type { SpawnSubject } from './kinds';

/** A spawn's parts in the open quest, and quests started from an NPC */
function questChildren({ info: spawn }: SpawnSubject, context: MenuContext): MenuItem[] {
  const { quest } = context;
  const children: MenuItem[] = [];
  if (quest) {
    const as: RoleTarget = { kind: spawn.kind === 'object' ? 'gameobject' : 'creature', id: spawn.entry };
    const objective = spawn.kind === 'object' ? 'use objective' : 'kill objective';
    const roles = [
      ['giver', 'Set as quest giver', 'Remove as quest giver'],
      ['ender', 'Set as quest ender', 'Remove as quest ender'],
      ['objective', `Add as ${objective}`, `Remove as ${objective}`],
    ] as const;
    for (const [role, set, unset] of roles) {
      const has = hasRole(quest.roles, role, as);
      const full = role === 'objective' && !has && quest.roles.objectives.every((t) => t !== null);
      children.push(full ? item(set, { disabledReason: OBJECTIVES_FULL }) : item(has ? unset : set, { action: { kind: 'toggleRole', role, spawn, on: !has } }));
    }
  }
  if (spawn.kind === 'creature' && context.connected) children.push(item('Find quests that start or end here…', { action: { kind: 'findQuests', spawn } }));
  if (spawn.kind === 'creature' && context.project) {
    children.push(item('Start a new quest from this NPC', { action: { kind: 'newQuest', spawn, after: false } }));
    if (quest) children.push(item('Start the next quest in this chain', { action: { kind: 'newQuest', spawn, after: true } }));
  }
  return children;
}

/** The Quests submenu on a spawn, offered when it has anything in it */
export const questParts: MenuSection<SpawnSubject> = {
  id: 'quest-parts',
  group: 'quest',
  appliesTo: (subject, context): subject is SpawnSubject =>
    subject.type === 'spawn' && !context.placing && questChildren(subject, context).length > 0,
  items: (subject, context) => [item('Quests', { children: questChildren(subject, context) })],
};
