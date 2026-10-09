import { item } from '../model';
import { NEEDS_DATABASE, type MenuSection } from '../section';
import type { SpawnSubject } from './kinds';

/** Any NPC can be given a gossip menu, or have its menu edited; either opens its editor on the Gossip tab */
export const gossip: MenuSection<SpawnSubject> = {
  id: 'gossip',
  group: 'world',
  appliesTo: (subject): subject is SpawnSubject => subject.type === 'spawn' && subject.target.kind === 'npc',
  items: ({ target, info }, context) => {
    if (target.kind !== 'npc') return [];
    const { has, count } = target.gossipMenu;
    const label = has ? 'Edit gossip menu…' : 'Add gossip menu…';
    if (target.origin === 'existing' && !context.connected) return [item(label, { disabledReason: NEEDS_DATABASE })];
    const hint = has && count !== null && count > 0 ? `${count} option${count === 1 ? '' : 's'}` : undefined;
    return [item(label, { action: { kind: 'editEntity', spawn: info, tab: 'gossip' }, ...(hint ? { hint } : {}) })];
  },
};
