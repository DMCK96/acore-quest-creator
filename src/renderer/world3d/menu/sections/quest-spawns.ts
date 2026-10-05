import { item, type MenuItem } from '../model';
import type { MenuSection } from '../section';
import type { GroundSubject } from './kinds';

/** With a quest open, the ground shows or hides its spawns (and its chain's) */
export const questSpawns: MenuSection<GroundSubject> = {
  id: 'quest-spawns',
  group: 'quest',
  appliesTo: (subject, context): subject is GroundSubject => subject.type === 'ground' && context.quest !== null && !context.placing,
  items: (_subject, context) => {
    const items: MenuItem[] = [item('Show quest spawns', { action: { kind: 'showSpawns', scope: 'quest' } })];
    if (context.quest?.chained) items.push(item('Show chain spawns', { action: { kind: 'showSpawns', scope: 'chain' } }));
    if (context.marked) items.push(item('Hide quest spawns', { action: { kind: 'hideSpawns' } }));
    return items;
  },
};
