import { item } from '../model';
import { NEEDS_GROUND, type MenuSection } from '../section';
import type { MenuSubject } from '../subject';

/** Copy coordinates: a spawn's own, or the ground's under the right-click */
export const coordinates: MenuSection = {
  id: 'coordinates',
  group: 'world',
  appliesTo: (subject, context): subject is MenuSubject => !context.placing,
  items: (subject) => {
    const label = 'Copy coordinates';
    if (subject.type === 'spawn') {
      const { x, y, z } = subject.info.placement;
      return [item(label, { action: { kind: 'copyCoordinates', at: { x, y, z } } })];
    }
    return [subject.at ? item(label, { action: { kind: 'copyCoordinates', at: subject.at } }) : item(label, { disabledReason: NEEDS_GROUND })];
  },
};
