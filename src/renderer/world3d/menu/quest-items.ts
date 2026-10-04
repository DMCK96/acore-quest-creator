import { hasRole, type RoleTarget } from '@core/modules/quest-roles';
import { item, type MenuContext, type MenuGroup, type MenuItem, type MenuTarget } from './model';
import { NEEDS_DATABASE, NEEDS_GROUND, newHere } from './world-items';

/** The open quest's items: spawn its NPCs here, give a spawn a part in it, start a new quest, show its spawns */

export const OPEN_A_QUEST = 'Open a quest first';
export const OBJECTIVES_FULL = 'All four objectives are in use';

export function questItems(target: MenuTarget, context: MenuContext): MenuGroup | null {
  if (context.placing || context.drawing) return null;
  const { quest } = context;
  const { hit, ground } = target;
  const items: MenuItem[] = [];
  if (!hit) {
    if (!quest) items.push(item('Spawn quest NPC here', { disabledReason: OPEN_A_QUEST }));
    else if (!ground) items.push(item('Spawn quest NPC here', { disabledReason: NEEDS_GROUND }));
    else {
      // Keyed by what each is, as two may share a name
      const children = quest.entities.map((entity) => ({
        ...(!entity.own && !context.connected
          ? item(entity.name, { disabledReason: NEEDS_DATABASE })
          : item(entity.name, { action: { kind: 'spawnQuestEntity', target: entity, at: ground } })),
        id: `${entity.kind}-${entity.entry}`,
      }));
      items.push(item('Spawn quest NPC here', { children }));
    }
    if (quest) items.push(...newHere(target, context, true));
    if (quest) {
      items.push(item('Show quest spawns', { action: { kind: 'showSpawns', scope: 'quest' } }));
      if (quest.chained) items.push(item('Show chain spawns', { action: { kind: 'showSpawns', scope: 'chain' } }));
      if (context.marked) items.push(item('Hide quest spawns', { action: { kind: 'hideSpawns' } }));
    }
  } else if (hit.type === 'spawn') {
    const spawn = hit.spawn;
    if (quest) {
      const as: RoleTarget = { kind: spawn.kind === 'object' ? 'gameobject' : 'creature', id: spawn.entry };
      for (const [role, label] of [['giver', 'Quest giver'], ['ender', 'Quest ender'], ['objective', spawn.kind === 'object' ? 'Use objective' : 'Kill objective']] as const) {
        const checked = hasRole(quest.roles, role, as);
        const full = role === 'objective' && !checked && quest.roles.objectives.every((t) => t !== null);
        items.push(full ? item(label, { checked, disabledReason: OBJECTIVES_FULL }) : item(label, { checked, action: { kind: 'toggleRole', role, spawn, on: !checked } }));
      }
    }
    if (spawn.kind === 'creature' && context.project) {
      items.push(item('Start a new quest from this NPC', { action: { kind: 'newQuest', spawn, after: false } }));
      if (quest) items.push(item('Start the next quest in this chain', { action: { kind: 'newQuest', spawn, after: true } }));
    }
  }
  return items.length > 0 ? { id: 'quest', items } : null;
}
