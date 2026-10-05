import { item, type MenuContext, type MenuGroup, type MenuItem, type MenuTarget } from './model';

/** The world's items: place here, copy and paste, remove a placed spawn, and the coordinates */

export const NEEDS_GROUND = 'Right-click the ground';
export const NEEDS_DATABASE = 'Needs the world database';
export const COPY_FIRST = 'Copy something first';

const counted = (label: string, n: number): string => (n > 1 ? `${label} ${n}` : label);

/** New NPC here… and New object here…, with or without a quest open; they need the ground and the database */
export function newHere(target: MenuTarget, context: MenuContext): MenuItem[] {
  const make = (label: string, what: 'creature' | 'object'): MenuItem =>
    !target.ground ? item(label, { disabledReason: NEEDS_GROUND })
    : !context.connected ? item(label, { disabledReason: NEEDS_DATABASE })
    : item(label, { action: { kind: 'newEntity', what, at: target.ground } });
  return [make('New NPC here…', 'creature'), make('New object here…', 'object')];
}

export function worldItems(target: MenuTarget, context: MenuContext): MenuGroup | null {
  const { hit, ground } = target;
  const items: MenuItem[] = [];
  if (hit?.type === 'spawn') {
    const n = target.selection.length;
    const spawn = hit.spawn;
    // One of the project's own NPCs or objects: its editor, and for an object whether it can be looted
    if (spawn.own) {
      items.push(item(spawn.kind === 'creature' ? 'Edit NPC…' : 'Edit object…', { action: { kind: 'editEntity', spawn } }));
      const lootable = spawn.kind === 'object' ? context.lootable(spawn.entry) : null;
      if (lootable === false) items.push(item('Make lootable…', { action: { kind: 'setLootable', spawn, on: true } }));
      else if (lootable === true) items.push(item('Stop being lootable', { action: { kind: 'setLootable', spawn, on: false } }));
    }
    items.push(item(counted('Copy', n), { action: { kind: 'copy' } }));
    items.push(item(counted('Duplicate', n), { action: { kind: 'duplicate' } }));
    const { x, y, z } = hit.spawn.placement;
    items.push(item('Copy coordinates', { action: { kind: 'copyCoordinates', at: { x, y, z } } }));
    if (hit.spawn.added || hit.spawn.own) items.push(item('Remove', { action: { kind: 'remove', spawn: hit.spawn } }));
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
  items.push(...newHere(target, context));
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
