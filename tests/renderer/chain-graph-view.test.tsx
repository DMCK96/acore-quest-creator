// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { Node, ReactFlowProps } from '@xyflow/react';
import { createAppStore } from '../../src/renderer/state/app-store';
import { makeMockApi, okv, nodeOf } from './mock-api';

// The graph's props, so the sizes React Flow measured can be reported back as it does
const flow = vi.hoisted(() => ({ props: null as ReactFlowProps | null }));
vi.mock('@xyflow/react', async (original) => {
  const real = await original<typeof import('@xyflow/react')>();
  return {
    ...real,
    ReactFlow: (props: ReactFlowProps) => {
      flow.props = props;
      return <real.ReactFlow {...props} />;
    },
  };
});

import { ChainDock } from '../../src/renderer/views/dock/ChainDock';

describe('the chain graph in the dock', () => {
  // A card without its measured size is hidden by React Flow until measured again, so a click
  // in that moment (the second click of a double-click) falls through to the pane
  it('keeps each card’s measured size on the nodes it hands React Flow', async () => {
    const store = createAppStore(makeMockApi({ listNodes: async () => okv([nodeOf({ questId: 10, title: 'Wolves' })]) }), { saveDelayMs: 0 });
    await store.getState().loadNodes();
    render(<ChainDock store={store} />);
    await screen.findAllByTestId('quest-node');
    act(() => flow.props!.onNodesChange!([{ type: 'dimensions', id: '10', dimensions: { width: 240, height: 80 } }]));
    await act(async () => { await store.getState().loadNodes(); });
    const card = (flow.props!.nodes as Node[]).find((n) => n.id === '10')!;
    expect(card.measured).toEqual({ width: 240, height: 80 });
  });

  // React Flow's own floor (0.5) stops Fit view short: a chain of eight quests did not fit a dock beside the world
  it('lets Fit view zoom out far enough for a long chain in a narrow dock', async () => {
    const store = createAppStore(makeMockApi({ listNodes: async () => okv([nodeOf({ questId: 10, title: 'Wolves' })]) }), { saveDelayMs: 0 });
    await store.getState().loadNodes();
    render(<ChainDock store={store} />);
    await screen.findAllByTestId('quest-node');
    expect(flow.props!.minZoom).toBeLessThanOrEqual(0.2);
  });
});
