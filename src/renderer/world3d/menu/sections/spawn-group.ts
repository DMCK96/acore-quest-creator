import { item, type MenuAction, type MenuItem } from '../model';
import { NEEDS_DATABASE, type MenuSection } from '../section';
import type { GroundSubject, SpawnSubject } from './kinds';

/**
 * Spawn groups (the server's pools): several selected spawns can be made a group, and a spawn in a
 * group can have that group edited, shown or left. Groups live in the world database, so every item
 * needs it.
 */
export const spawnGroup: MenuSection<GroundSubject | SpawnSubject> = {
  id: 'spawn-group',
  group: 'world',
  appliesTo: (subject, context): subject is GroundSubject | SpawnSubject =>
    subject.type === 'spawn' || (subject.type === 'ground' && subject.selection.length > 1 && !context.placing),
  items: (subject, context) => {
    const doing = (action: MenuAction): Pick<MenuItem, 'action' | 'disabledReason'> => (context.connected ? { action } : { disabledReason: NEEDS_DATABASE });
    const items: MenuItem[] = [];
    if (subject.selection.length > 1) items.push(item('Group these spawns…', doing({ kind: 'groupSpawns', spawns: subject.selection })));
    if (subject.type === 'spawn' && subject.target.spawn.group !== null) {
      const id = subject.target.spawn.group;
      items.push(
        item('Spawn group', {
          children: [
            item('Edit group…', doing({ kind: 'editGroup', id })),
            item('Show group', doing({ kind: 'showGroup', id })),
            item('Remove from group', doing({ kind: 'leaveGroup', spawn: subject.info })),
          ],
        }),
      );
    }
    return items;
  },
};
