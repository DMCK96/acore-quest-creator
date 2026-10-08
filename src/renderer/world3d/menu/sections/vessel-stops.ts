import { item } from '../model';
import type { MenuSection } from '../section';
import type { GroundSubject, SpawnSubject } from './kinds';

/** A ship or zeppelin under the right-click, whatever stands on it: its stops are listed in a dialog */
export const vesselStops: MenuSection<GroundSubject | SpawnSubject> = {
  id: 'vessel-stops',
  group: 'world',
  appliesTo: (subject, context): subject is GroundSubject | SpawnSubject =>
    !context.placing && (subject.type === 'ground' || subject.type === 'spawn') && Boolean(subject.vessel),
  items: (subject) => [item('Show stops…', { action: { kind: 'vesselStops', dock: subject.vessel?.dock ?? null } })],
};
