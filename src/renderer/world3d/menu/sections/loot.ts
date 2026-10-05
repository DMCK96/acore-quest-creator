import { item } from '../model';
import type { MenuSection } from '../section';
import type { SpawnSubject } from './kinds';

/** A project object can be made lootable, or stop being so */
export const loot: MenuSection<SpawnSubject> = {
  id: 'loot',
  group: 'world',
  appliesTo: (subject): subject is SpawnSubject =>
    subject.type === 'spawn' && subject.target.kind === 'object' && subject.target.lootable !== null,
  items: ({ target, info }) =>
    target.kind === 'object' && target.lootable
      ? [item('Stop being lootable', { action: { kind: 'setLootable', spawn: info, on: false } })]
      : [item('Make lootable…', { action: { kind: 'setLootable', spawn: info, on: true } })],
};
