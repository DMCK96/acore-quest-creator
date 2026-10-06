// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactFlowProps } from '@xyflow/react';
import { createAppStore } from '../../src/renderer/state/app-store';
import { makeMockApi, okv, errv, sampleOpen, nodeOf, emptyHistoryResult } from './mock-api';

// The graph's props, so a drag between handles (which jsdom cannot do) is its `onConnect` called
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

const drift = { missingTables: [], unregistered: [], missingColumns: [], typeMismatches: [] };
const form = { name: 'w', role: 'world' as const, host: 'h', port: 1, user: 'u', database: 'd', password: 'p' };
const PREV = 'quest_template_addon.PrevQuestID';
const list = (n: number) => ({ steps: Array.from({ length: n }, (_, i) => ({ id: i + 1, label: `S${i + 1}`, kind: 'quest' as const, where: null })), current: n, saved: 0 });

const questOf = (questId: number, values: Record<string, unknown> = {}) =>
  sampleOpen({ questId, aggregate: { ...sampleOpen().aggregate, questId, values: { 'quest_template.LogTitle': `Quest ${questId}`, ...values } as never } });

async function connected(over: Record<string, any> = {}) {
  let store!: ReturnType<typeof createAppStore>;
  const api = makeMockApi({
    saveProfile: async () => okv({ id: 1, ...form }),
    connect: async () => okv({ profileId: 1, schemaHash: 'h', drift, blocking: false }),
    listNodes: async () => okv([nodeOf({ questId: 10, title: 'Wolves' }), nodeOf({ questId: 11, title: 'Bears', x: 320 })]),
    openQuest: async (id: number) => okv(questOf(id)),
    // The main process tells the renderer of each step it closes
    historyEnd: async () => {
      store.getState().setHistory(list(1));
      return okv(true);
    },
    ...over,
  });
  store = createAppStore(api, { saveDelayMs: 0 });
  await store.getState().connect(form);
  await store.getState().loadNodes();
  return { api, store };
}

describe('linking quests in the store', () => {
  it('linkQuests edits the target quest, as one undo step', async () => {
    const { api, store } = await connected({
      historyUndo: async () => okv({ ...emptyHistoryResult, step: { id: 1, label: 'Unlock Bears after Wolves', kind: 'quest', where: { questId: 11 } }, quests: [{ questId: 11, aggregate: questOf(11).aggregate }] }),
    });
    expect(await store.getState().linkQuests(10, 11)).toBe(true);
    expect(api.historyBegin).toHaveBeenCalledTimes(1);
    expect(api.historyBegin).toHaveBeenCalledWith('Unlock Bears after Wolves', { questId: 11 });
    const sent = vi.mocked(api.updateQuest).mock.calls.at(-1)![0];
    expect(sent.questId).toBe(11);
    expect(sent.values[PREV]).toBe(10);
    const begin = vi.mocked(api.historyBegin).mock.invocationCallOrder[0]!;
    const write = vi.mocked(api.updateQuest).mock.invocationCallOrder.at(-1)!;
    const end = vi.mocked(api.historyEnd).mock.invocationCallOrder[0]!;
    expect([begin < write, write < end]).toEqual([true, true]);
    // Can undo: the step is in the history
    expect(store.getState().history.current).toBe(1);
    await store.getState().undo();
    expect(api.historyUndo).toHaveBeenCalledTimes(1);
    expect(store.getState().open!.aggregate.values[PREV]).toBeUndefined();
  });

  it('a refused link shows the message and writes nothing', async () => {
    const { api, store } = await connected();
    expect(await store.getState().linkQuests(10, 10)).toBe(false);
    expect(store.getState().error).toBe('A quest cannot lead to itself.');
    expect(api.updateQuest).not.toHaveBeenCalled();
    expect(api.historyBegin).not.toHaveBeenCalled();
  });

  it('goes back to the quest that was open, and reloads the graph', async () => {
    const { api, store } = await connected();
    await store.getState().openQuest(10);
    store.getState().editQuest();
    const reads = vi.mocked(api.listNodes).mock.calls.length;
    expect(await store.getState().linkQuests(10, 11)).toBe(true);
    expect(vi.mocked(api.updateQuest).mock.calls.at(-1)![0].questId).toBe(11);
    expect(store.getState().open!.questId).toBe(10);
    expect(store.getState().screen).toBe('edit');
    expect(vi.mocked(api.listNodes).mock.calls.length).toBeGreaterThan(reads);
  });

  it('refuses a target whose prerequisite is a quest not on the graph, writing nothing', async () => {
    const { api, store } = await connected({ openQuest: async (id: number) => okv(questOf(id, id === 11 ? { [PREV]: 500 } : {})) });
    expect(await store.getState().linkQuests(10, 11)).toBe(false);
    expect(store.getState().error).toBe('Bears already unlocks after another quest; change it in the quest editor.');
    expect(api.updateQuest).not.toHaveBeenCalled();
  });

  it('writes nothing when the target quest cannot be opened, and shows why', async () => {
    const { api, store } = await connected({ openQuest: async (id: number) => (id === 11 ? errv('UNKNOWN', 'Quest 11 is gone') : okv(questOf(id))) });
    await store.getState().openQuest(10);
    expect(await store.getState().linkQuests(10, 11)).toBe(false);
    expect(store.getState().error).toBe('Quest 11 is gone');
    expect(api.updateQuest).not.toHaveBeenCalled();
  });

  it('unlinkQuests clears the target prerequisite only when it is that quest', async () => {
    const { api, store } = await connected({ openQuest: async (id: number) => okv(questOf(id, id === 11 ? { [PREV]: 10 } : {})) });
    expect(await store.getState().unlinkQuests(12, 11)).toBe(false);
    expect(api.updateQuest).not.toHaveBeenCalled();
    expect(await store.getState().unlinkQuests(10, 11)).toBe(true);
    const sent = vi.mocked(api.updateQuest).mock.calls.at(-1)![0];
    expect([sent.questId, sent.values[PREV]]).toEqual([11, 0]);
    expect(api.historyBegin).toHaveBeenLastCalledWith('Remove the link from Wolves to Bears', { questId: 11 });
  });
});

describe('linking quests on the graph', () => {
  async function graph(over: Record<string, any> = {}) {
    const made = await connected(over);
    render(<ChainDock store={made.store} />);
    await screen.findAllByTestId('quest-node');
    return made;
  }

  it('a drag from one quest to another links them', async () => {
    const { api, store } = await graph();
    expect(flow.props!.nodesConnectable).toBe(true);
    await act(async () => flow.props!.onConnect!({ source: '10', target: '11', sourceHandle: null, targetHandle: null }));
    await waitFor(() => expect(vi.mocked(api.updateQuest).mock.calls.at(-1)?.[0].values[PREV]).toBe(10));
    expect(store.getState().error).toBeNull();
  });

  it('cannot connect while a quest is saving', async () => {
    const { store } = await graph();
    act(() => store.setState({ saving: true }));
    expect(flow.props!.nodesConnectable).toBe(false);
  });

  const linked = (component: string, owner: number) => ({
    listNodes: async () => okv([nodeOf({ questId: 10, title: 'Wolves', links: [{ to: 11, component: component as never, owner }] }), nodeOf({ questId: 11, title: 'Bears', x: 320 })]),
    openQuest: async (id: number) => okv(questOf(id, id === 11 ? { [PREV]: 10 } : {})),
  });
  const rightClick = (edgeId: string) => {
    const edge = flow.props!.edges!.find((e) => e.id === edgeId)!;
    act(() => flow.props!.onEdgeContextMenu!({ preventDefault() {}, clientX: 50, clientY: 60 } as never, edge));
  };

  it('a turn-in link is removed from its right-click menu', async () => {
    const { api } = await graph(linked('unlock.afterTurnIn', 11));
    rightClick('10>11>unlock.afterTurnIn');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove link' }));
    await waitFor(() => expect(vi.mocked(api.updateQuest).mock.calls.at(-1)?.[0].values[PREV]).toBe(0));
    expect(screen.queryByRole('menu', { name: 'Link actions' })).toBeNull();
  });

  it('another kind of link is changed in the quest editor instead', async () => {
    const { api, store } = await graph(linked('start.offeredStraightAway', 10));
    rightClick('10>11>start.offeredStraightAway');
    expect(screen.queryByRole('menuitem', { name: 'Remove link' })).toBeNull();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit in the quest editor' }));
    await waitFor(() => expect(store.getState().screen).toBe('edit'));
    expect(store.getState().open!.questId).toBe(10);
    expect(api.updateQuest).not.toHaveBeenCalled();
  });

  it('closes the link menu on Escape', async () => {
    await graph(linked('unlock.afterTurnIn', 11));
    rightClick('10>11>unlock.afterTurnIn');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu', { name: 'Link actions' })).toBeNull();
  });
});
