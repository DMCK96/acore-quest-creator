import { item, type MenuItem } from '../model';
import { NEEDS_DATABASE, NEEDS_GROUND, type MenuSection } from '../section';
import type { GroundSubject } from './kinds';

/** Place an existing NPC or object here, or make a new one standing here; both need the ground and the database */
export const create: MenuSection<GroundSubject> = {
  id: 'create',
  group: 'world',
  appliesTo: (subject, context): subject is GroundSubject => subject.type === 'ground' && !context.placing,
  items: ({ at }, context) => {
    const make = (label: string, kind: 'placeHere' | 'newEntity', what: 'creature' | 'object'): MenuItem =>
      !at ? item(label, { disabledReason: NEEDS_GROUND })
      : !context.connected ? item(label, { disabledReason: NEEDS_DATABASE })
      : item(label, { action: { kind, what, at } });
    return [
      make('Place NPC here…', 'placeHere', 'creature'),
      make('Place object here…', 'placeHere', 'object'),
      make('New NPC here…', 'newEntity', 'creature'),
      make('New object here…', 'newEntity', 'object'),
    ];
  },
};
