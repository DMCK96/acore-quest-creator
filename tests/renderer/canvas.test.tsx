// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '../../src/renderer/state/app-store';
import { CanvasHome } from '../../src/renderer/views/CanvasHome';
import { QuestNodeCard } from '../../src/renderer/views/QuestNodeCard';
import { makeMockApi, okv, sampleOpen, nodeOf } from './mock-api';

const drift = { missingTables: [], unregistered: [], missingColumns: [], typeMismatches: [] };
const rec = { id: 1, name: 'w', role: 'world' as const, host: 'h', port: 1, user: 'u', database: 'd' };
const form = { name: 'w', role: 'world' as const, host: 'h', port: 1, user: 'u', database: 'd', password: 'p' };

async function canvas(over: Record<string, any> = {}) {
  const api = makeMockApi({
    saveProfile: async () => okv(rec), connect: async () => okv({ profileId: 1, schemaHash: 'h', drift, blocking: false }),
    listNodes: async () => okv([nodeOf(), nodeOf({ questId: 60002, title: 'Second', x: 320 })]),
    openQuest: async () => okv(sampleOpen()), newQuest: async () => okv(sampleOpen({ questId: 60003 })),
    searchQuests: async () => okv([{ id: 5, title: 'Wolves of Elwynn', level: 3 }]), validate: async () => okv([]), ...over,
  });
  const store = createAppStore(api, { saveDelayMs: 0 });
  await store.getState().connect(form);
  const view = render(<CanvasHome store={store} />);
  return { api, store, view };
}

describe('QuestNodeCard', () => {
  it('shows title, id, level and status badges', () => {
    render(<QuestNodeCard node={nodeOf({ isNew: true, exported: true, unsafe: true, errors: 2, warnings: 1 })} selected={false} />);
    for (const t of ['Wolves', '#60001', 'Level 10', 'New', 'Exported', 'Unsafe', '2 errors', '1 warning']) expect(screen.getByText(t)).toBeInTheDocument();
  });
  it('falls back to an untitled label and hides zero counts', () => {
    render(<QuestNodeCard node={nodeOf({ title: '' })} selected={false} />);
    expect(screen.getByText('(untitled quest)')).toBeInTheDocument();
    expect(screen.queryByText(/error/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Quest 60001: (untitled quest)' })).toBeInTheDocument();
  });
  it('shows how the quest starts, its groups and whether it is connected', () => {
    render(<QuestNodeCard node={nodeOf({ starts: ['npc', 'script'], groups: [{ group: 5, kind: 'pickOne' }], notConnected: true })} selected={false} />);
    for (const t of ['NPC', 'Script', 'Pick one', 'Not connected']) expect(screen.getByText(t)).toBeInTheDocument();
  });
});

describe('CanvasHome', () => {
  it('draws one card per node', async () => {
    await canvas();
    expect(await screen.findAllByTestId('quest-node')).toHaveLength(2);
  });
  it('shows an inviting empty state with the two ways to start', async () => {
    await canvas({ listNodes: async () => okv([]) });
    expect(await screen.findByText(/start your journey/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New quest' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add existing quest' })).toBeInTheDocument();
  });
  it('creates a quest where the empty canvas is double-clicked', async () => {
    const { api, view } = await canvas();
    await screen.findAllByTestId('quest-node');
    fireEvent.doubleClick(view.container.querySelector('.react-flow__pane')!, { clientX: 400, clientY: 300 });
    await waitFor(() => expect(api.newQuest).toHaveBeenCalledWith(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) })));
  });
  it('the New quest button creates a node and opens its editor drawer', async () => {
    const { api, store } = await canvas();
    await userEvent.click(screen.getByRole('button', { name: 'New quest' }));
    await waitFor(() => expect(api.newQuest).toHaveBeenCalled());
    expect(store.getState().screen).toBe('edit');
    expect(await screen.findByRole('complementary', { name: 'Quest editor' })).toBeInTheDocument();
    await waitFor(() => expect((api.listNodes as any).mock.calls.length).toBeGreaterThanOrEqual(2));
  });
  it('adds an existing quest with its whole chain through search and places it', async () => {
    const { api, store } = await canvas();
    await userEvent.click(screen.getByRole('button', { name: 'Add existing quest' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('searchbox'), 'wolves');
    await userEvent.click(await within(dialog).findByRole('button', { name: /Wolves of Elwynn/ }));
    await waitFor(() => expect(api.addQuestChain).toHaveBeenCalledWith(5, expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) })));
    expect(store.getState().screen).toBe('edit');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('opens a node by double-click or Enter, without moving it', async () => {
    const { api } = await canvas();
    const [first, second] = await screen.findAllByTestId('quest-node');
    fireEvent.doubleClick(first);
    await waitFor(() => expect(api.openQuest).toHaveBeenCalledWith(60001));
    fireEvent.keyDown(second, { key: 'Enter' });
    await waitFor(() => expect(api.openQuest).toHaveBeenCalledWith(60002));
  });
  it('highlights the node whose editor is open', async () => {
    await canvas({ openQuest: async () => okv(sampleOpen({ questId: 60001 })) });
    const [first] = await screen.findAllByTestId('quest-node');
    fireEvent.doubleClick(first);
    await waitFor(() => expect(screen.getAllByTestId('quest-node')[0]).toHaveAttribute('aria-current', 'true'));
    expect(screen.getAllByTestId('quest-node')[1]).not.toHaveAttribute('aria-current');
  });
  it('adds the rest of a chain from the "+N linked" chip', async () => {
    const { api } = await canvas({ listNodes: async () => okv([nodeOf({ offCanvasLinks: 2 })]) });
    await userEvent.click(await screen.findByRole('button', { name: 'Add 2 linked quests not on the canvas' }));
    await waitFor(() => expect(api.addQuestChain).toHaveBeenCalledWith(60001));
  });
});

describe('drawer', () => {
  const opened = async () => {
    const c = await canvas();
    await c.store.getState().openQuest(60001);
    return c;
  };
  it('closes with the button, saving the draft and refreshing the nodes', async () => {
    const { api, store } = await opened();
    store.getState().setValue('quest_template.LogTitle', 'Edited');
    const before = (api.listNodes as any).mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: 'Close editor' }));
    await waitFor(() => expect(store.getState().screen).toBe('pick'));
    expect(api.updateQuest).toHaveBeenCalledWith(expect.objectContaining({ values: expect.objectContaining({ 'quest_template.LogTitle': 'Edited' }) }));
    expect((api.listNodes as any).mock.calls.length).toBeGreaterThan(before);
    expect(screen.queryByRole('complementary', { name: 'Quest editor' })).toBeNull();
    expect(screen.getAllByTestId('quest-node').length).toBe(2);
  });
  it('closes with Escape', async () => {
    const { store } = await opened();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(store.getState().screen).toBe('pick'));
  });
  it('expands to full width and back', async () => {
    await opened();
    const toggle = screen.getByRole('button', { name: 'Expand editor' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Expand editor' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('arranging and removing', () => {
  it('queues drags, coalescing to the latest position per quest, and saves the viewport once', async () => {
    const { api, store } = await canvas();
    await screen.findAllByTestId('quest-node');
    store.getState().moveNode(60001, 10, 20);
    store.getState().moveNode(60001, 30, 40);
    store.getState().moveNode(60002, 5, 5);
    store.getState().setViewport({ x: -10, y: 5, zoom: 0.5 });
    expect(store.getState().nodes.find((n) => n.questId === 60001)).toMatchObject({ x: 30, y: 40 });
    await store.getState().flushMoves();
    expect(api.moveNodes).toHaveBeenCalledTimes(1);
    expect((api.moveNodes as any).mock.calls[0][0]).toEqual(expect.arrayContaining([{ questId: 60001, x: 30, y: 40 }, { questId: 60002, x: 5, y: 5 }]));
    expect((api.moveNodes as any).mock.calls[0][0]).toHaveLength(2);
    expect(api.saveViewport).toHaveBeenCalledWith({ x: -10, y: 5, zoom: 0.5 });
    await store.getState().flushMoves();
    expect(api.moveNodes).toHaveBeenCalledTimes(1);
    expect(api.saveViewport).toHaveBeenCalledTimes(1);
  });
  it('removes a node only after a confirmation that says the database is untouched', async () => {
    const { api } = await canvas({ listNodes: async () => okv([nodeOf()]) });
    await screen.findAllByTestId('quest-node');
    await userEvent.click(screen.getByRole('button', { name: 'Remove quest 60001 from canvas' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/removes it from this project only\. nothing in your database changes/i)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(api.removeNode).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Remove quest 60001 from canvas' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(api.removeNode).toHaveBeenCalledWith(60001));
  });
  it('restores the saved viewport when the canvas loads', async () => {
    const { store } = await canvas({ projectState: async () => okv({ name: 'p', filePath: null, dirty: false, idRangeStart: 60000, idRangeEnd: 99999, outputDir: 'C:\\out', viewport: { x: -120, y: 40, zoom: 0.6 } }) });
    await screen.findAllByTestId('quest-node');
    expect(store.getState().viewport).toEqual({ x: -120, y: 40, zoom: 0.6 });
  });
});
