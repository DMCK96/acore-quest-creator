import { item } from '../model';
import { NEEDS_DATABASE, type MenuSection } from '../section';
import type { SpawnSubject } from './kinds';

/**
 * An object can be made lootable, or stop being so: a project one, or a database one of a type the
 * editor models, which is brought into the project first (and so needs the database)
 */
export const loot: MenuSection<SpawnSubject> = {
  id: 'loot',
  group: 'world',
  appliesTo: (subject): subject is SpawnSubject =>
    subject.type === 'spawn' && subject.target.kind === 'object' && subject.target.lootable !== null,
  items: ({ target, info, stored }, context) => {
    const on = !(target.kind === 'object' && target.lootable);
    const label = on ? 'Make lootable…' : 'Stop being lootable';
    if (!stored && !context.connected) return [item(label, { disabledReason: NEEDS_DATABASE })];
    return [item(label, { action: { kind: 'setLootable', spawn: info, on } })];
  },
};
