import type { CanvasNode, OpenResult } from '@shared/ipc';
import type { NameBook } from '@core/links/component';
import { readEntities } from '@core/entities/model';
import { questRoles } from '@core/modules/quest-roles';
import { creatureName, objectName } from '@core/modules/summaries';
import type { QuestMenuInfo } from './menu/model';

/**
 * The open quest as the 3D view's right-click menu sees it: its parts for NPCs and objects, what can
 * be spawned for it, and the chain it is in (every quest on the canvas linked to it, either way).
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

export function questMenuInfo(open: OpenResult, nodes: readonly CanvasNode[], names: NameBook): QuestMenuInfo {
  const values = open.aggregate.values;
  const title = values['quest_template.LogTitle'];
  const roles = questRoles(values);
  const { npcs, objects } = readEntities(values);
  const entities: QuestMenuInfo['entities'] = [
    ...npcs.map((n) => ({ kind: 'creature' as const, entry: n.entry, name: n.name.trim() || `New NPC ${n.entry}`, own: true })),
    ...objects.map((o) => ({ kind: 'object' as const, entry: o.entry, name: o.name.trim() || `New object ${o.entry}`, own: true })),
  ];
  const listed = new Set(entities.map((e) => `${e.kind}:${e.entry}`));
  for (const target of [...roles.givers, ...roles.enders, ...roles.objectives]) {
    if (!target) continue;
    const kind = target.kind === 'gameobject' ? 'object' : 'creature';
    const key = `${kind}:${target.id}`;
    if (listed.has(key)) continue;
    listed.add(key);
    entities.push({ kind, entry: target.id, name: kind === 'creature' ? creatureName(target.id, names) : objectName(target.id, names), own: false });
  }
  return {
    id: open.questId,
    title: typeof title === 'string' && title !== '' ? title : `Quest ${open.questId}`,
    roles,
    entities,
    chained: chainOf(nodes, open.questId).length > 1,
  };
}
