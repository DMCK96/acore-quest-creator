import { item } from '../model';
import { NEEDS_DATABASE, type MenuSection } from '../section';
import type { SpawnSubject } from './kinds';

/** Any NPC or object opens its editor; an existing one's rows come from the world database */
export const edit: MenuSection<SpawnSubject> = {
  id: 'edit',
  group: 'world',
  appliesTo: (subject): subject is SpawnSubject => subject.type === 'spawn',
  items: ({ target, info }, context) => {
    const label = target.kind === 'npc' ? 'Edit NPC…' : 'Edit object…';
    if (target.origin === 'existing' && !context.connected) return [item(label, { disabledReason: NEEDS_DATABASE })];
    return [item(label, { action: { kind: 'editEntity', spawn: info } })];
  },
};
