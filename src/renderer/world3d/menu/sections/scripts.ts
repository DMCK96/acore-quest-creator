import { item } from '../model';
import { NEEDS_DATABASE, type MenuSection } from '../section';
import type { SpawnSubject } from './kinds';

/** Any NPC can be given scenes of its own, or have them edited; either opens its editor on the Scripts tab */
export const scripts: MenuSection<SpawnSubject> = {
  id: 'scripts',
  group: 'world',
  appliesTo: (subject): subject is SpawnSubject => subject.type === 'spawn' && subject.target.kind === 'npc',
  items: ({ target, info }, context) => {
    if (target.kind !== 'npc') return [];
    const { has, count } = target.scenes;
    // A database NPC the project has not opened may already have scenes the tool wrote: they load when it opens
    const label = has ? 'Edit scripts…' : count === null ? 'Add or edit scripts…' : 'Add script…';
    if (target.origin === 'existing' && !context.connected) return [item(label, { disabledReason: NEEDS_DATABASE })];
    const hint = has && count !== null && count > 0 ? `${count} scene${count === 1 ? '' : 's'}` : undefined;
    return [item(label, { action: { kind: 'editEntity', spawn: info, tab: 'scripts' }, ...(hint ? { hint } : {}) })];
  },
};
