import type { ProjectEntities } from '@core/entities/model';

/** The ids of a kind the project already holds in the editor, saved to the app yet or not */
export function heldIds(kind: string, entities: ProjectEntities): number[] {
  switch (kind) {
    case 'gossipMenu': return entities.npcs.flatMap((n) => (n.gossipMenu?.menus ?? []).map((m) => m.menuId));
    case 'gossipText': return entities.npcs.flatMap((n) => (n.gossipMenu?.menus ?? []).map((m) => m.textId));
    case 'trainer': return entities.npcs.flatMap((n) => (n.trainer ? [n.trainer.trainerId] : []));
    default: return [];
  }
}

/**
 * Ids the app handed out, lifted clear of the ones the editor holds. The app counts what it has saved, and a
 * change made a moment ago may not have reached it, so a second allocation could be given the first one's ids.
 */
export function aboveHeld(ids: number[], held: readonly number[]): number[] {
  if (ids.length === 0 || held.length === 0) return ids;
  const lift = Math.max(0, Math.max(...held) + 1 - ids[0]!);
  return lift === 0 ? ids : ids.map((id) => id + lift);
}
