import { item, type MenuSpawn } from '../model';
import { NEEDS_DATABASE, type MenuSection } from '../section';
import type { GroundSubject, SpawnSubject } from './kinds';

/** The NPCs a right-click acts on: the selection's, or the right-clicked NPC when nothing is selected */
const chosen = (subject: GroundSubject | SpawnSubject): MenuSpawn[] =>
  (subject.selection.length > 0 ? subject.selection : subject.type === 'spawn' ? [subject.info] : []).filter((s) => s.kind === 'creature');

/** Which game events NPC spawns follow of their own: the world database keeps a database spawn's, the project its own */
export const spawnEvents: MenuSection<GroundSubject | SpawnSubject> = {
  id: 'spawn-events',
  group: 'world',
  appliesTo: (subject, context): subject is GroundSubject | SpawnSubject =>
    subject.type === 'spawn' || (subject.type === 'ground' && subject.selection.length > 0 && !context.placing),
  items: (subject, context) => {
    const spawns = chosen(subject);
    if (spawns.length === 0) return [];
    const label = spawns.length === 1 ? 'Event…' : `Event of ${spawns.length} spawns…`;
    if (!context.connected && spawns.some((s) => !s.own)) return [item(label, { disabledReason: NEEDS_DATABASE })];
    return [item(label, { action: { kind: 'spawnEvents', spawns } })];
  },
};
