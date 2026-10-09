import { item } from '../model';
import { NEEDS_DATABASE, type MenuSection } from '../section';
import type { SpawnSubject } from './kinds';

/** Any NPC can be made a trainer, or have its spells edited; either opens its editor on the Trainer tab */
export const trainer: MenuSection<SpawnSubject> = {
  id: 'trainer',
  group: 'world',
  appliesTo: (subject): subject is SpawnSubject => subject.type === 'spawn' && subject.target.kind === 'npc',
  items: ({ target, info }, context) => {
    if (target.kind !== 'npc') return [];
    const { teaches, count } = target.trainer;
    const label = teaches ? 'Edit trainer spells…' : 'Make trainer…';
    if (target.origin === 'existing' && !context.connected) return [item(label, { disabledReason: NEEDS_DATABASE })];
    const hint = teaches && count !== null && count > 0 ? `${count} spell${count === 1 ? '' : 's'}` : undefined;
    return [item(label, { action: { kind: 'editEntity', spawn: info, tab: 'trainer' }, ...(hint ? { hint } : {}) })];
  },
};
