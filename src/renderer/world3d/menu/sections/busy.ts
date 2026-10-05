import { item } from '../model';
import type { MenuSection } from '../section';
import type { MenuSubject } from '../subject';

/** What the view is busy with comes first: stop placing, or finish the path being drawn */
export const busy: MenuSection = {
  id: 'busy',
  group: 'busy',
  appliesTo: (subject, context): subject is MenuSubject => context.placing || context.drawing !== null,
  items: (_subject, context) =>
    context.drawing
      ? [
          item('Finish path', { action: { kind: 'finishPath' } }),
          item('Undo last point', { action: { kind: 'undoPoint' } }),
          item('Cancel path', { action: { kind: 'cancelPath' } }),
        ]
      : [item('Stop placing', { action: { kind: 'stopPlacing' } })],
};
