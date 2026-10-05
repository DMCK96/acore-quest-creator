import { item } from '../model';
import type { MenuSection } from '../section';
import type { SpawnSubject } from './kinds';

/** One of the project's own NPCs or objects opens its editor */
export const edit: MenuSection<SpawnSubject> = {
  id: 'edit',
  group: 'world',
  appliesTo: (subject): subject is SpawnSubject => subject.type === 'spawn' && subject.target.origin === 'new',
  items: ({ target, info }) => [item(target.kind === 'npc' ? 'Edit NPC…' : 'Edit object…', { action: { kind: 'editEntity', spawn: info } })],
};
