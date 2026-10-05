import { item } from '../model';
import { COPY_FIRST, NEEDS_GROUND, type MenuSection } from '../section';
import { counted, type GroundSubject, type SpawnSubject } from './kinds';

/** Copy and duplicate the selection from a spawn; paste it on the ground */
export const clipboard: MenuSection<GroundSubject | SpawnSubject> = {
  id: 'clipboard',
  group: 'world',
  appliesTo: (subject, context): subject is GroundSubject | SpawnSubject =>
    subject.type === 'spawn' || (subject.type === 'ground' && !context.placing),
  items: (subject, context) => {
    if (subject.type === 'spawn') {
      const n = subject.selection.length;
      return [item(counted('Copy', n), { action: { kind: 'copy' } }), item(counted('Duplicate', n), { action: { kind: 'duplicate' } })];
    }
    const { at } = subject;
    const { count, blocked } = context.clipboard;
    const paste = count > 0 ? `Paste here (${count})` : 'Paste here';
    return [
      !at ? item(paste, { disabledReason: NEEDS_GROUND })
      : count === 0 ? item(paste, { disabledReason: COPY_FIRST })
      : blocked ? item(paste, { disabledReason: blocked })
      : item(paste, { action: { kind: 'paste', at } }),
    ];
  },
};
