import { hasRole, type RoleTarget } from '@core/modules/quest-roles';
import { item, type MenuContext, type MenuGroup, type MenuItem, type MenuTarget } from './model';
import { newHere } from './world-items';

/** The open quest's items: new quest NPCs here, a spawn's part in it or a quest started from it, show its spawns */

export const OBJECTIVES_FULL = 'All four objectives are in use';

export function questItems(target: MenuTarget, context: MenuContext): MenuGroup | null {
  if (context.placing || context.drawing) return null;
  const { quest } = context;
  const { hit, ground } = target;
  const items: MenuItem[] = [];
  if (!hit) {
    if (quest) items.push(...newHere(target, context, true));
    if (quest) {
      items.push(item('Show quest spawns', { action: { kind: 'showSpawns', scope: 'quest' } }));
      if (quest.chained) items.push(item('Show chain spawns', { action: { kind: 'showSpawns', scope: 'chain' } }));
      if (context.marked) items.push(item('Hide quest spawns', { action: { kind: 'hideSpawns' } }));
    }
  } else if (hit.type === 'spawn') {
    // A spawn's part in the open quest, and quests started from it, sit under one Quests submenu
    const spawn = hit.spawn;
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
    if (spawn.kind === 'creature' && context.project) {
      children.push(item('Start a new quest from this NPC', { action: { kind: 'newQuest', spawn, after: false } }));
      if (quest) children.push(item('Start the next quest in this chain', { action: { kind: 'newQuest', spawn, after: true } }));
    }
    if (children.length > 0) items.push(item('Quests', { children }));
  }
  return items.length > 0 ? { id: 'quest', items } : null;
}
