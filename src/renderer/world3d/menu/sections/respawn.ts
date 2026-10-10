import { item } from '../model';
import { NEEDS_DATABASE, type MenuSection } from '../section';
import { chosen, type GroundSubject, type SpawnSubject } from './kinds';

/** How long spawns take to respawn: the world database keeps a database spawn's time, the project its own */
export const respawn: MenuSection<GroundSubject | SpawnSubject> = {
  id: 'respawn',
  group: 'world',
  appliesTo: (subject, context): subject is GroundSubject | SpawnSubject =>
    subject.type === 'spawn' || (subject.type === 'ground' && subject.selection.length > 0 && !context.placing),
  items: (subject, context) => {
    const spawns = chosen(subject);
    if (spawns.length === 0) return [];
    const label = spawns.length === 1 ? 'Respawn time…' : `Respawn time of ${spawns.length} spawns…`;
    if (!context.connected && spawns.some((s) => !s.own)) return [item(label, { disabledReason: NEEDS_DATABASE })];
    return [item(label, { action: { kind: 'respawn', spawns } })];
  },
};
