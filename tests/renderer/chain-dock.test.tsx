// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '../../src/renderer/state/app-store';
import { ChainDock } from '../../src/renderer/views/dock/ChainDock';
import { makeMockApi, okv, sampleOpen, nodeOf } from './mock-api';

const drift = { missingTables: [], unregistered: [], missingColumns: [], typeMismatches: [] };
const rec = { id: 1, name: 'w', role: 'world' as const, host: 'h', port: 1, user: 'u', database: 'd' };
const form = { name: 'w', role: 'world' as const, host: 'h', port: 1, user: 'u', database: 'd', password: 'p' };

async function chainDock(over: Record<string, any> = {}) {
  const api = makeMockApi({
    saveProfile: async () => okv(rec), connect: async () => okv({ profileId: 1, schemaHash: 'h', drift, blocking: false }),
    listNodes: async () => okv([nodeOf()]), openQuest: async (id: number) => okv(sampleOpen({ questId: id })),
    searchQuests: async () => okv([{ id: 5, title: 'Wolves of Elwynn', level: 3 }]), validate: async () => okv([]), ...over,
  });
  const store = createAppStore(api, { saveDelayMs: 0 });
  await store.getState().connect(form);
  render(<ChainDock store={store} />);
  return { api, store };
}

describe('the chain dock', () => {
  it('holds the quest tools and the graph', async () => {
    await chainDock();
    const root = screen.getByTestId('chain-dock');
    expect(await within(root).findAllByTestId('quest-node')).toHaveLength(1);
    expect(within(root).getByRole('toolbar', { name: 'Quest tools' })).toBeInTheDocument();
    expect(root.querySelector('.canvas-empty')).toBeNull();
  });

  it('shows the empty state when the project has no quests', async () => {
    await chainDock({ listNodes: async () => okv([]) });
    expect(await screen.findByRole('heading', { name: 'Quests' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create New Quest' })).toBeInTheDocument();
  });

  it('keeps the quest search folded away until asked for, and opens the quest picked from it', async () => {
    const { api, store } = await chainDock();
    const find = screen.getByRole('button', { name: 'Find a quest' });
    expect(find).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('searchbox', { name: 'Search quests' })).toBeNull();
    await userEvent.click(find);
    expect(find).toHaveAttribute('aria-expanded', 'true');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search quests' }), 'wolves');
    await userEvent.click(await screen.findByRole('button', { name: /Wolves of Elwynn/ }));
    await waitFor(() => expect(api.openQuest).toHaveBeenCalledWith(5));
    expect(store.getState().open?.questId).toBe(5);
    await userEvent.click(find);
    expect(screen.queryByRole('searchbox', { name: 'Search quests' })).toBeNull();
  });

  it('lists the open quest\'s NPCs and objects on its card, the focused one marked', async () => {
    const values = { 'quest_template.LogTitle': 'Wolves', creature_queststarter: [{ id: 1423 }], gameobject_questender: [{ id: 77 }] };
    const { store } = await chainDock({ openQuest: async (id: number) => okv(sampleOpen({ questId: id, aggregate: { ...sampleOpen().aggregate, values } })) });
    const card = (await screen.findAllByTestId('quest-node'))[0]!;
    expect(within(card).queryByRole('list', { name: 'Parts' })).toBeNull();
    await store.getState().openQuest(60001);
    const parts = await within(card).findByRole('list', { name: 'Parts' });
    const giver = within(parts).getByText('NPC #1423').closest('li')!;
    const ender = within(parts).getByText('Object #77').closest('li')!;
    expect(giver).not.toHaveAttribute('aria-current');
    store.getState().setFocus(60001, { kind: 'creature', entry: 1423 });
    await waitFor(() => expect(giver).toHaveAttribute('aria-current', 'true'));
    expect(ender).not.toHaveAttribute('aria-current');
  });

  it('places an added chain at the middle of the graph, not of the window', async () => {
    const { api } = await chainDock();
    await screen.findAllByTestId('quest-node');
    const pane = document.querySelector('.chain-dock__pane')!;
    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 500, width: 400, height: 200, right: 500, bottom: 700, x: 100, y: 500, toJSON: () => ({}) });
    await userEvent.click(screen.getByRole('button', { name: 'Add existing quest' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add existing quest chain' });
    await userEvent.type(within(dialog).getByRole('searchbox'), 'wolves');
    await userEvent.click(await within(dialog).findByRole('button', { name: /Wolves of Elwynn/ }));
    await waitFor(() => expect(api.addQuestChain).toHaveBeenCalledWith(5, { x: 300, y: 600 }));
  });

  it('shows the open quest in a preview strip beside the graph', async () => {
    const { store } = await chainDock();
    expect(screen.queryByRole('complementary', { name: 'Quest preview' })).toBeNull();
    await store.getState().openQuest(60001);
    const preview = await screen.findByRole('complementary', { name: 'Quest preview' });
    expect(screen.getByTestId('chain-dock')).toContainElement(preview);
  });
});
