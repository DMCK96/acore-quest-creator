// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const created = vi.hoisted(() => [] as { options: any; dispose: ReturnType<typeof vi.fn>; lookAt: ReturnType<typeof vi.fn>; setPlacing: ReturnType<typeof vi.fn> }[]);
vi.mock('../../src/renderer/world3d/world3d', () => ({
  createWorld3D: (options: any) => {
    const world = {
      options, setOwnSpawns: vi.fn(), setWorldLayer: vi.fn(), setMarked: vi.fn(), setPlacing: vi.fn(),
      dispose: vi.fn(), cancelPath: vi.fn(), lookAt: vi.fn(), select: vi.fn(), setSpawnVisibility: vi.fn(), setScenery: vi.fn(), setTool: vi.fn(), setFalloff: vi.fn(), target: () => ({ x: 0, y: 0, z: 0 }),
      spawnStatus: () => ({ capped: { creatures: false, objects: false }, error: null, loading: 0 }),
    };
    created.push(world);
    return world;
  },
}));

import { createAppStore } from '../../src/renderer/state/app-store';
import { AppShell } from '../../src/renderer/views/AppShell';
import { NamesProvider } from '../../src/renderer/state/names';
import { DEFAULT_PREFERENCES, writePreferences } from '../../src/renderer/preferences/store';
import { newNpc } from '../../src/core/entities/model';
import { makeMockApi, okv, sampleOpen, nodeOf } from './mock-api';

const drift = { missingTables: [], unregistered: [], missingColumns: [], typeMismatches: [] };
const form = { name: 'w', role: 'world' as const, host: 'h', port: 1, user: 'u', database: 'd', password: 'p' };
const profile = { id: 1, ...form, dbcDir: '', clientDir: 'E:/WoW', exportDir: '', lastConnectedAt: null };
const state = { name: 'North', filePath: 'C:\w\north.aqc', dirty: false, idRangeStart: 60000, idRangeEnd: 99999, outputDir: 'C:\out', viewport: { x: 0, y: 0, zoom: 1 } };

async function shell(over: Record<string, any> = {}, client = true) {
  vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1]), { status: 200 }));
  localStorage.setItem('acqc.welcome.seen', JSON.stringify(['C:\w\north.aqc']));
  const api = makeMockApi({
    saveProfile: async () => okv(profile), listProfiles: async () => okv([profile]),
    connect: async () => okv({ profileId: 1, schemaHash: 'h', drift, blocking: false, ...(client ? { clientDir: 'E:/WoW' } : {}) }),
    projectState: async () => okv(state), listNodes: async () => okv([nodeOf()]), openQuest: async () => okv(sampleOpen()),
    newQuest: async () => okv(sampleOpen({ questId: 60003 })), validate: async () => okv([]), ...over,
  });
  const store = createAppStore(api, { saveDelayMs: 0 });
  await store.getState().connect(form);
  // The app gives the world its api through the names provider, as App does
  render(<NamesProvider api={api}><AppShell store={store} /></NamesProvider>);
  await waitFor(() => expect(store.getState().project.name).not.toBe(''));
  return { api, store };
}
afterEach(() => {
  writePreferences(DEFAULT_PREFERENCES);
  created.length = 0;
  localStorage.clear();
  vi.unstubAllGlobals();
});
const quests = () => screen.getByRole('button', { name: 'Quests' });
const dock = () => screen.queryByTestId('chain-dock');

describe('the app shell', () => {
  it('Ctrl+Z on a keyboard whose letters are not Latin still undoes', async () => {
    const { api } = await shell();
    fireEvent.keyDown(document.body, { key: 'я', code: 'KeyZ', ctrlKey: true });
    await waitFor(() => expect(api.historyUndo).toHaveBeenCalledTimes(1));
  });

  it('Ctrl+Z and Ctrl+Y undo and redo outside text fields, and leave text fields alone', async () => {
    const { api } = await shell();
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(api.historyUndo).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'Z', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(api.historyRedo).toHaveBeenCalledTimes(2));
    const field = document.createElement('input');
    document.body.appendChild(field);
    fireEvent.keyDown(field, { key: 'z', ctrlKey: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(api.historyUndo).toHaveBeenCalledTimes(1);
    field.remove();
  });

  it('opens on the world with the dock closed, and no workspace tabs', async () => {
    await shell();
    expect(screen.queryByRole('tab', { name: 'Quests' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Quests', pressed: false })).toBeTruthy();
    expect(document.querySelector('.dock-layout [data-testid="chain-dock"]')).toBeNull();
    expect(screen.getByRole('region', { name: 'World' })).toBeVisible();
    await waitFor(() => expect(created).toHaveLength(1));
    expect(screen.queryByRole('button', { name: 'New quest' })).toBeNull();
  });

  it('the Quests button opens and closes the dock, and the world stays mounted', async () => {
    await shell();
    const world = document.querySelector('.world-workspace');
    await userEvent.click(screen.getByRole('button', { name: 'Quests' }));
    expect(screen.getByTestId('chain-dock')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Quests' }));
    expect(screen.queryByTestId('chain-dock')).toBeNull();
    expect(document.querySelector('.world-workspace')).toBe(world);
    expect(created.every((w) => w.dispose.mock.calls.length === 0)).toBe(true);
  });

  it('the dock holds the quest graph and its tools, and the world beside it keeps drawing', async () => {
    await shell();
    await waitFor(() => expect(created).toHaveLength(1));
    await userEvent.click(quests());
    expect(quests()).toHaveAttribute('aria-pressed', 'true');
    expect(await within(dock()!).findAllByTestId('quest-node')).toHaveLength(1);
    const tools = screen.getByRole('toolbar', { name: 'Quest tools' });
    for (const name of ['New quest', 'Add existing quest', 'Fit view']) expect(within(tools).getByRole('button', { name })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'World' })).toBeVisible();
    expect(created).toHaveLength(1);
  });

  it('toggles the dock from the keyboard', async () => {
    await shell();
    quests().focus();
    await userEvent.keyboard('{Enter}');
    expect(dock()).not.toBeNull();
    expect(quests()).toHaveFocus();
    await userEvent.keyboard(' ');
    expect(dock()).toBeNull();
  });

  it('opening a quest from anywhere opens the dock, unless the author just closed it', async () => {
    const { store } = await shell();
    await act(async () => { await store.getState().openQuest(60001); });
    expect(screen.getByTestId('chain-dock')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Quests' }));
    expect(screen.queryByTestId('chain-dock')).toBeNull();
  });

  // After a reconnect the shell is drawn again: a quest opened before then is not a reason to open the dock
  it('a shell drawn again leaves the dock closed for a quest opened before it', async () => {
    const { api, store } = await shell();
    await act(async () => { await store.getState().openQuest(60001); });
    expect(dock()).not.toBeNull();
    cleanup();
    render(<NamesProvider api={api}><AppShell store={store} /></NamesProvider>);
    await new Promise((r) => setTimeout(r, 20));
    expect(dock()).toBeNull();
    await act(async () => { await store.getState().openQuest(60001); });
    await waitFor(() => expect(dock()).not.toBeNull());
  });

  it('follows the Preferences dock side', async () => {
    await shell();
    await userEvent.click(screen.getByRole('button', { name: 'Quests' }));
    expect(document.querySelector('.dock-layout')!.getAttribute('data-side')).toBe('bottom');
    writePreferences({ ...DEFAULT_PREFERENCES, dockSide: 'right' });
    await waitFor(() => expect(document.querySelector('.dock-layout')!.getAttribute('data-side')).toBe('right'));
  });

  it('a quest preview that opens after the author closed the dock leaves it closed', async () => {
    let finishSave: (value: unknown) => void = () => {};
    const { store } = await shell({ updateQuest: () => new Promise((resolve) => { finishSave = resolve; }) });
    await act(async () => { await store.getState().openQuest(60001); });
    act(() => store.getState().editQuest());
    act(() => store.getState().setValue('quest_template.LogTitle', 'Edited'));
    await waitFor(() => expect(dock()).not.toBeNull());
    // Back to chain saves first; the author closes the dock before the save comes back
    const back = store.getState().backToChain();
    await userEvent.click(quests());
    expect(dock()).toBeNull();
    await act(async () => {
      finishSave(okv(true));
      await back;
    });
    expect(store.getState().screen).toBe('preview');
    expect(dock()).toBeNull();
  });

  it('a quest that finishes opening after the author closed the dock leaves it closed', async () => {
    let finishOpen: (value: unknown) => void = () => {};
    const { store } = await shell({ openQuest: () => new Promise((resolve) => { finishOpen = resolve; }) });
    await userEvent.click(quests());
    const opening = store.getState().openQuest(60001);
    await userEvent.click(quests());
    await act(async () => {
      finishOpen(okv(sampleOpen()));
      await opening;
    });
    expect(store.getState().screen).toBe('preview');
    expect(dock()).toBeNull();
  });

  it('opens the dock again for a quest opened after the author closed it', async () => {
    const { store } = await shell();
    await act(async () => { await store.getState().openQuest(60001); });
    await userEvent.click(quests());
    expect(dock()).toBeNull();
    await act(async () => { await store.getState().openQuest(60001); });
    await waitFor(() => expect(dock()).not.toBeNull());
  });

  it('Escape in the dock is the dock\'s: it closes the preview and leaves the world\'s welcome open', { timeout: 20000 }, async () => {
    const { store } = await shell();
    await act(async () => { await store.getState().openQuest(60001); });
    // A project not greeted yet: the next time the world draws, it is
    localStorage.clear();
    await userEvent.click(quests());
    await userEvent.click(quests());
    expect(await screen.findByRole('dialog', { name: 'Welcome' })).toBeInTheDocument();
    within(dock()!).getByRole('button', { name: 'Close preview' }).focus();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(store.getState().screen).toBe('pick'));
    expect(screen.getByRole('dialog', { name: 'Welcome' })).toBeInTheDocument();
  });

  it('starts a quest from the welcome in the dock', { timeout: 20000 }, async () => {
    const { api } = await shell();
    // A project not greeted yet: the next time the world draws, it is
    localStorage.clear();
    await userEvent.click(quests());
    await userEvent.click(quests());
    await userEvent.click(await screen.findByRole('button', { name: 'Start a quest' }));
    await waitFor(() => expect(api.newQuest).toHaveBeenCalled());
    expect(dock()).not.toBeNull();
    expect(await screen.findByRole('list', { name: 'Modules' })).toBeInTheDocument();
  });

  it('welcomes a project not saved yet without its placeholder name', async () => {
    await shell({ projectState: async () => okv({ ...state, name: 'Untitled Project', filePath: null }) });
    expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
  });

  it('saves with Ctrl+S from the world too', async () => {
    const { api } = await shell();
    fireEvent.keyDown(document, { key: 's', ctrlKey: true });
    await waitFor(() => expect(api.saveProject).toHaveBeenCalled());
  });

  it('opens Project and Settings from the app bar, and shows the orb mark', async () => {
    await shell();
    await userEvent.click(screen.getByRole('button', { name: 'Project' }));
    expect(await screen.findByRole('dialog', { name: 'Project' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Project' })).toBeNull());
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    expect(document.querySelector('.app-bar .orb-mark[data-orb-target]')).not.toBeNull();
  });

  it('without a game client, offers settings and the quests from the world', async () => {
    await shell({}, false);
    await userEvent.click(screen.getByRole('button', { name: 'Go to Quests' }));
    expect(dock()).not.toBeNull();
    expect(quests()).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
  });

  it('starts the next quest of the chain from an NPC right-clicked in the world, with it as giver and ender, and shows it', async () => {
    const { store } = await shell();
    await act(async () => { await store.getState().openQuest(60001); });
    // Opening a quest opens the dock; the author closes it, and the quest stays open
    await userEvent.click(quests());
    expect(dock()).toBeNull();
    await waitFor(() => expect(created).toHaveLength(1));
    const guard = { kind: 'creature', guid: 80330, entry: 1423, name: 'Guard', own: false, added: false, pathId: 0, wander: 0, map: 0, placement: { x: 1, y: 2, z: 3, orientation: 0, rotation: null } };
    act(() => created[0]!.options.onContextMenu({ ground: { x: 1, y: 2, z: 3 }, hit: { type: 'spawn', spawn: guard }, selection: [guard] }, { x: 10, y: 10 }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Quests' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Start the next quest in this chain' }));
    await waitFor(() => expect(store.getState().open?.questId).toBe(60003));
    await waitFor(() => expect(store.getState().open!.aggregate.values['quest_template_addon.PrevQuestID']).toBe(60001));
    const values = store.getState().open!.aggregate.values;
    expect(values.creature_queststarter).toEqual([{ id: 1423 }]);
    expect(values.creature_questender).toEqual([{ id: 1423 }]);
    await waitFor(() => expect(dock()).not.toBeNull());
  });

  it('takes the world to a quest opened in the dock', async () => {
    const giver = { kind: 'creature', guid: 80330, entry: 1423, name: 'Guard', map: 0, x: 500, y: 10, z: 20, role: 'giver' };
    const { store } = await shell({ questSpawnList: vi.fn(async () => okv([{ questId: 60001, title: 'Wolves', spawns: [giver], capped: false, cut: 0 }])) });
    await waitFor(() => expect(created).toHaveLength(1));
    await act(async () => { await store.getState().openQuest(60001); });
    await waitFor(() => expect(created[0]!.lookAt).toHaveBeenCalledWith(500, 10, 20));
    expect(screen.getByRole('button', { name: 'Back' })).toHaveProperty('disabled', false);
  });

  it('Show in World takes the world to the focused quest again', async () => {
    const giver = { kind: 'creature', guid: 80330, entry: 1423, name: 'Guard', map: 0, x: 500, y: 10, z: 20, role: 'giver' };
    const questSpawnList = vi.fn(async () => okv([{ questId: 60001, title: 'Wolves', spawns: [giver], capped: false, cut: 0 }]));
    const { store } = await shell({ questSpawnList });
    await waitFor(() => expect(created).toHaveLength(1));
    await act(async () => { await store.getState().openQuest(60001); });
    await waitFor(() => expect(questSpawnList).toHaveBeenCalledTimes(1));
    await userEvent.click(within(dock()!).getByRole('button', { name: 'Show in World' }));
    await waitFor(() => expect(questSpawnList).toHaveBeenCalledTimes(2));
  });

  it('selecting a part of the open quest in the world focuses it, without moving the camera', async () => {
    const values = { 'quest_template.LogTitle': 'Wolves', creature_queststarter: [{ id: 1423 }] };
    const { store } = await shell({ openQuest: async () => okv(sampleOpen({ aggregate: { ...sampleOpen().aggregate, values } })) });
    await waitFor(() => expect(created).toHaveLength(1));
    await act(async () => { await store.getState().openQuest(60001); });
    const world = created[0]!;
    const before = world.lookAt.mock.calls.length;
    const pick = (entry: number) => ({ kind: 'creature', guid: 80330, entry, name: 'Guard', own: false, added: false, pathId: 0, event: null, position: { x: 1, y: 2, z: 3 } });
    act(() => world.options.onSelect(pick(4000)));
    expect(store.getState().focus.part).toBeNull();
    act(() => world.options.onSelect(pick(1423)));
    expect(store.getState().focus).toMatchObject({ questId: 60001, part: { kind: 'creature', entry: 1423 } });
    await new Promise((r) => setTimeout(r, 20));
    expect(world.lookAt.mock.calls.length).toBe(before);
  });

  it('going to a part of the open quest with Find focuses it too', async () => {
    const values = { 'quest_template.LogTitle': 'Wolves', creature_queststarter: [{ id: 1423 }] };
    const guard = { kind: 'creature', guid: 80330, entry: 1423, name: 'Guard', map: 0, x: 500, y: 10, z: 20 };
    const { store } = await shell({
      openQuest: async () => okv(sampleOpen({ aggregate: { ...sampleOpen().aggregate, values } })),
      searchEntities: vi.fn(async () => okv([{ id: 1423, name: 'Guard', detail: '' }])),
      findSpawns: vi.fn(async () => okv({ spawns: [guard], capped: false })),
    });
    await waitFor(() => expect(created).toHaveLength(1));
    await act(async () => { await store.getState().openQuest(60001); });
    await userEvent.click(screen.getByRole('button', { name: 'Find…' }));
    await userEvent.type(await screen.findByRole('searchbox', { name: 'Find by name or ID' }), 'guard');
    await userEvent.click(await screen.findByRole('button', { name: /Guard/ }));
    await userEvent.click((await screen.findAllByRole('button', { name: /^Go to spawn/ }))[0]!);
    await waitFor(() => expect(store.getState().focus).toMatchObject({ questId: 60001, part: { kind: 'creature', entry: 1423 } }));
  });

  describe('Place in world from the quest editor', () => {
    const values = { 'quest_template.LogTitle': 'Wolves', creature_queststarter: [{ id: 12000005 }] };
    async function editing(client = true) {
      const { store } = await shell({
        openQuest: async () => okv(sampleOpen({ aggregate: { ...sampleOpen().aggregate, values } })),
        projectEntities: async () => okv({ npcs: [{ ...newNpc(12000005), name: 'Hela' }], objects: [], items: [] }),
      }, client);
      await act(async () => {
        await store.getState().loadEntities();
        await store.getState().openQuest(60001);
      });
      act(() => store.getState().editQuest());
      await userEvent.click(within(screen.getByRole('list', { name: 'Modules' })).getByRole('button', { name: /^Quest Giver/ }));
      return store;
    }

    it('steps the editor aside, places the NPC in the world, and brings the editor back on its panel', async () => {
      await editing();
      await waitFor(() => expect(created).toHaveLength(1));
      await userEvent.click(within(screen.getByRole('dialog', { name: 'Quest Giver' })).getByRole('button', { name: 'Place in world' }));
      expect(screen.queryByRole('dialog', { name: 'Edit quest' })).toBeNull();
      await waitFor(() => expect(created[0]!.setPlacing).toHaveBeenLastCalledWith({ kind: 'creature', entry: 12000005 }));
      expect(screen.getByText(/Placing Hela \(#12000005\)/)).toBeTruthy();
      act(() => created[0]!.options.onPlaceEnd());
      expect(await screen.findByRole('dialog', { name: 'Edit quest' })).toBeTruthy();
      expect(screen.getByRole('dialog', { name: 'Quest Giver' })).toBeTruthy();
    });

    it('Show in World steps the editor aside while the World shows the quest, and Done brings it back', async () => {
      const store = await editing();
      await waitFor(() => expect(created).toHaveLength(1));
      const before = store.getState().focus.nonce;
      await userEvent.click(within(screen.getByRole('dialog', { name: 'Edit quest' })).getByRole('button', { name: 'Show in World' }));
      expect(screen.queryByRole('dialog', { name: 'Edit quest' })).toBeNull();
      expect(store.getState().focus).toMatchObject({ questId: 60001, part: null, nonce: before + 1 });
      expect(await screen.findByText(/Showing Wolves\./)).toBeTruthy();
      await userEvent.click(screen.getByRole('button', { name: 'Done' }));
      expect(await screen.findByRole('dialog', { name: 'Edit quest' })).toBeTruthy();
      expect(screen.getByRole('dialog', { name: 'Quest Giver' })).toBeTruthy();
    });

    it('is not offered without a game client', async () => {
      await editing(false);
      expect(within(screen.getByRole('dialog', { name: 'Quest Giver' })).getByText('Made with this quest.')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Place in world' })).toBeNull();
    });
  });

  it('leaves the open quest alone when the new quest cannot be made', async () => {
    const { store } = await shell({ newQuest: async () => ({ ok: false, error: { code: 'UNKNOWN', message: 'no' } }) });
    await act(async () => { await store.getState().openQuest(60001); });
    await waitFor(() => expect(created).toHaveLength(1));
    const guard = { kind: 'creature', guid: 80330, entry: 1423, name: 'Guard', own: false, added: false, pathId: 0, wander: 0, map: 0, placement: { x: 1, y: 2, z: 3, orientation: 0, rotation: null } };
    act(() => created[0]!.options.onContextMenu({ ground: { x: 1, y: 2, z: 3 }, hit: { type: 'spawn', spawn: guard }, selection: [guard] }, { x: 10, y: 10 }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Quests' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Start the next quest in this chain' }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const values = store.getState().open?.aggregate.values ?? {};
    expect(values['quest_template_addon.PrevQuestID']).toBeUndefined();
    expect(values.creature_queststarter).toBeUndefined();
  });
});
