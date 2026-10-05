import { item } from '../model';
import type { MenuSection } from '../section';
import type { SpawnSubject } from './kinds';

/** A spawn the project placed can be removed; the database's own cannot */
export const remove: MenuSection<SpawnSubject> = {
  id: 'remove',
  group: 'world',
  appliesTo: (subject): subject is SpawnSubject => subject.type === 'spawn' && subject.target.spawn.origin === 'new',
  items: ({ info }) => [item('Remove', { action: { kind: 'remove', spawn: info } })],
};
