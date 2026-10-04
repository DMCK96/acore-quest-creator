import { item, type MenuContext, type MenuGroup, type MenuItem, type MenuTarget } from './model';
import { NEEDS_GROUND } from './world-items';

/** How an NPC moves: start a new path where the ground was right-clicked, its wander distance, or no path */

export const WALKS_A_PATH = 'Walks a path: remove the path first';

export function movementItems(target: MenuTarget, context: MenuContext): MenuGroup | null {
  if (context.placing || context.drawing) return null;
  const items: MenuItem[] = [];
  const { hit, ground, selection } = target;
  if (!hit) {
    const [only] = selection;
    if (selection.length === 1 && only!.kind === 'creature' && only!.pathId === 0) {
      items.push(ground ? item('Start path here', { action: { kind: 'startPath', spawn: only!, at: ground } }) : item('Start path here', { disabledReason: NEEDS_GROUND }));
    }
  } else if (hit.type === 'spawn' && hit.spawn.kind === 'creature') {
    const spawn = hit.spawn;
    items.push(spawn.pathId > 0 ? item('Change wander distance…', { disabledReason: WALKS_A_PATH }) : item('Change wander distance…', { action: { kind: 'wander', spawn } }));
    if (spawn.pathId > 0) items.push(item('Remove path', { action: { kind: 'removePath', spawn } }));
  }
  return items.length > 0 ? { id: 'movement', items } : null;
}
