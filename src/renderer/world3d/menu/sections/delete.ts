import { item } from '../model';
import { NEEDS_DATABASE, type MenuSection } from '../section';
import { chosen, counted, type SpawnSubject } from './kinds';

/**
 * Any NPC or object can be deleted, with the selection when the right-clicked spawn is part of it. A
 * database spawn needs the world database to be read first; the project's own and placed ones do not.
 */
export const deletion: MenuSection<SpawnSubject> = {
  id: 'delete',
  group: 'world',
  appliesTo: (subject): subject is SpawnSubject => subject.type === 'spawn',
  items: (subject, context) => {
    const spawns = chosen(subject);
    const label = counted('Delete', spawns.length);
    if (!context.connected && spawns.some((s) => !s.own && !s.added)) return [item(label, { disabledReason: NEEDS_DATABASE })];
    return [item(label, { action: { kind: 'delete', spawns } })];
  },
};
