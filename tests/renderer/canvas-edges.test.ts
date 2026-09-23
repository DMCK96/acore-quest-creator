import { describe, it, expect } from 'vitest';
import { toFlowEdges } from '../../src/renderer/views/canvas-edges';
import { nodeOf } from './mock-api';

describe('toFlowEdges', () => {
  it('draws one edge per link whose target is on the canvas, styled by kind', () => {
    const nodes = [
      nodeOf({ questId: 1, links: [
        { to: 2, component: 'unlock.afterTurnIn', owner: 2 },
        { to: 3, component: 'start.offeredStraightAway', owner: 1 },
        { to: 99, component: 'unlock.nextQuest', owner: 1 },
      ] }),
      nodeOf({ questId: 2, links: [{ to: 3, component: 'gate.breadcrumb', owner: 2 }] }),
      nodeOf({ questId: 3 }),
    ];
    expect(toFlowEdges(nodes)).toEqual([
      { id: '1>2>unlock.afterTurnIn', source: '1', target: '2', className: 'edge--turnin', animated: false },
      { id: '1>3>start.offeredStraightAway', source: '1', target: '3', className: 'edge--offer', animated: true },
      { id: '2>3>gate.breadcrumb', source: '2', target: '3', className: 'edge--breadcrumb', animated: false },
    ]);
  });
  it('gives every link kind a class', () => {
    const kinds = ['unlock.afterTurnIn', 'unlock.whileInLog', 'unlock.nextQuest', 'start.offeredStraightAway', 'gate.breadcrumb', 'group.finishAll', 'start.smartai'] as const;
    const nodes = [nodeOf({ questId: 1, links: kinds.map((component) => ({ to: 2, component, owner: 1 })) }), nodeOf({ questId: 2 })];
    expect(toFlowEdges(nodes).map((e) => e.className)).toEqual(['edge--turnin', 'edge--inlog', 'edge--turnin', 'edge--offer', 'edge--breadcrumb', 'edge--finishall', 'edge--script']);
  });
});
