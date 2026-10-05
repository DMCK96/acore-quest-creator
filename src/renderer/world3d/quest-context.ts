import type { CanvasNode, OpenResult } from '@shared/ipc';
import { questRoles } from '@core/modules/quest-roles';
import type { QuestMenuInfo } from './menu/model';

/**
 * The open quest as the 3D view's right-click menu sees it: its parts for NPCs and objects, and the
 * chain it is in (every quest on the canvas linked to it, either way).
 */

/** The quests linked to `questId`, either way and however far, left to right as the canvas lays them out */
export function chainOf(nodes: readonly CanvasNode[], questId: number): number[] {
  const known = new Map(nodes.map((n) => [n.questId, n]));
  if (!known.has(questId)) return [questId];
  const next = new Map<number, Set<number>>();
  const join = (a: number, b: number): void => {
    if (!known.has(a) || !known.has(b)) return;
    next.set(a, (next.get(a) ?? new Set()).add(b));
    next.set(b, (next.get(b) ?? new Set()).add(a));
  };
  for (const node of nodes) for (const link of node.links) join(node.questId, link.to);
  const seen = new Set([questId]);
  const todo = [questId];
  while (todo.length > 0) {
    for (const other of next.get(todo.pop()!) ?? []) {
      if (seen.has(other)) continue;
      seen.add(other);
      todo.push(other);
    }
  }
  return [...seen].sort((a, b) => known.get(a)!.x - known.get(b)!.x || a - b);
}

export function questMenuInfo(open: OpenResult, nodes: readonly CanvasNode[]): QuestMenuInfo {
  const values = open.aggregate.values;
  const title = values['quest_template.LogTitle'];
  const roles = questRoles(values);
  return {
    id: open.questId,
    title: typeof title === 'string' && title !== '' ? title : `Quest ${open.questId}`,
    roles,
    chained: chainOf(nodes, open.questId).length > 1,
  };
}
