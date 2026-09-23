import type { Edge } from '@xyflow/react';
import type { CanvasNode } from '@shared/ipc';
import type { ComponentId } from '@core/links/model';

/**
 * How each link kind is drawn, so the shape of an edge tells the user what it means without a
 * legend: solid lines are turn-in style unlocks, dashes mark softer or script-driven links.
 */
export const EDGE_CLASS: Record<string, string> = {
  'unlock.afterTurnIn': 'edge--turnin',
  'unlock.nextQuest': 'edge--turnin',
  'unlock.whileInLog': 'edge--inlog',
  'start.offeredStraightAway': 'edge--offer',
  'gate.breadcrumb': 'edge--breadcrumb',
  'group.finishAll': 'edge--finishall',
  'start.smartai': 'edge--script',
};

/**
 * Walks nodes and their links in canvas order, emitting one React Flow edge per link whose target
 * is also on the canvas. A link to a quest that has not been added yet has nothing to draw to, and
 * is instead reflected in that node's `offCanvasLinks` chip.
 */
export function toFlowEdges(nodes: readonly CanvasNode[]): Edge[] {
  const onCanvas = new Set(nodes.map((n) => n.questId));
  const edges: Edge[] = [];
  for (const node of nodes) {
    for (const link of node.links) {
      if (!onCanvas.has(link.to)) continue;
      edges.push({
        id: `${node.questId}>${link.to}>${link.component}`,
        source: String(node.questId),
        target: String(link.to),
        className: EDGE_CLASS[link.component as ComponentId] ?? 'edge--turnin',
        animated: link.component === 'start.offeredStraightAway',
      });
    }
  }
  return edges;
}
