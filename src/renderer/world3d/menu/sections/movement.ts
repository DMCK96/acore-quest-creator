import { item, type MenuContext, type MenuItem, type MenuSpawn } from '../model';
import { NEEDS_DATABASE, NEEDS_GROUND, ON_A_VESSEL, WALKS_A_PATH, type MenuSection } from '../section';
import type { GroundSubject, SpawnSubject } from './kinds';

/** A world NPC's movement is kept by the world database; a project NPC's by the project */
const offline = (spawn: MenuSpawn, context: MenuContext): boolean => !context.connected && spawn.own === false;

/** How an NPC moves: start a new path where the ground was right-clicked, its wander distance, or no path */
export const movement: MenuSection<GroundSubject | SpawnSubject> = {
  id: 'movement',
  group: 'movement',
  appliesTo: (subject, context): subject is GroundSubject | SpawnSubject =>
    !context.placing && !context.drawing && (subject.type === 'ground' || (subject.type === 'spawn' && subject.target.kind === 'npc')),
  items: (subject, context) => {
    if (subject.type === 'ground') {
      const { selection, at } = subject;
      const [only] = selection;
      if (selection.length !== 1 || only!.kind !== 'creature' || only!.pathId !== 0) return [];
      return [
        context.vessel ? item('Start path here', { disabledReason: ON_A_VESSEL })
        : !at ? item('Start path here', { disabledReason: NEEDS_GROUND })
        : offline(only!, context) ? item('Start path here', { disabledReason: NEEDS_DATABASE })
        : item('Start path here', { action: { kind: 'startPath', spawn: only!, at } }),
      ];
    }
    const spawn = subject.info;
    const items: MenuItem[] = [
      spawn.pathId > 0 ? item('Change wander distance…', { disabledReason: WALKS_A_PATH })
      : offline(spawn, context) ? item('Change wander distance…', { disabledReason: NEEDS_DATABASE })
      : item('Change wander distance…', { action: { kind: 'wander', spawn } }),
    ];
    if (spawn.pathId > 0) {
      items.push(
        context.vessel ? item('Remove path', { disabledReason: ON_A_VESSEL })
        : offline(spawn, context) ? item('Remove path', { disabledReason: NEEDS_DATABASE })
        : item('Remove path', { action: { kind: 'removePath', spawn } }),
      );
    }
    return items;
  },
};
