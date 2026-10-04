import { item, type MenuContext, type MenuGroup, type MenuItem, type MenuTarget } from './model';

/** The world's items: place here, copy and paste, remove a placed spawn, and the coordinates */

export const NEEDS_GROUND = 'Right-click the ground';
export const NEEDS_DATABASE = 'Needs the world database';
export const COPY_FIRST = 'Copy something first';

const counted = (label: string, n: number): string => (n > 1 ? `${label} ${n}` : label);

export function worldItems(target: MenuTarget, context: MenuContext): MenuGroup | null {
  const { hit, ground } = target;
  const items: MenuItem[] = [];
  if (hit?.type === 'spawn') {
    const n = target.selection.length;
    items.push(item(counted('Copy', n), { action: { kind: 'copy' } }));
    items.push(item(counted('Duplicate', n), { action: { kind: 'duplicate' } }));
    const { x, y, z } = hit.spawn.placement;
    items.push(item('Copy coordinates', { action: { kind: 'copyCoordinates', at: { x, y, z } } }));
    if (hit.spawn.added) items.push(item('Remove', { action: { kind: 'remove', spawn: hit.spawn } }));
    return { id: 'world', items };
  }
  if (hit?.type === 'point') {
    return { id: 'world', items: [item('Copy coordinates', ground ? { action: { kind: 'copyCoordinates', at: ground } } : { disabledReason: NEEDS_GROUND })] };
  }
  const place = (label: string, what: 'creature' | 'object'): MenuItem =>
    !ground ? item(label, { disabledReason: NEEDS_GROUND })
    : !context.connected ? item(label, { disabledReason: NEEDS_DATABASE })
    : item(label, { action: { kind: 'placeHere', what, at: ground } });
  items.push(place('Place NPC here…', 'creature'), place('Place object here…', 'object'));
  const { count, blocked } = context.clipboard;
  const paste = count > 0 ? `Paste here (${count})` : 'Paste here';
  items.push(
    !ground ? item(paste, { disabledReason: NEEDS_GROUND })
    : count === 0 ? item(paste, { disabledReason: COPY_FIRST })
    : blocked ? item(paste, { disabledReason: blocked })
    : item(paste, { action: { kind: 'paste', at: ground } }),
  );
  items.push(ground ? item('Copy coordinates', { action: { kind: 'copyCoordinates', at: ground } }) : item('Copy coordinates', { disabledReason: NEEDS_GROUND }));
  return { id: 'world', items };
}
