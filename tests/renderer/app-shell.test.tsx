// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const created = vi.hoisted(() => [] as { options: any; dispose: ReturnType<typeof vi.fn>; setActive: ReturnType<typeof vi.fn> }[]);
vi.mock('../../src/renderer/world3d/world3d', () => ({
  createWorld3D: (options: any) => {
    const world = {
      options, setOwnSpawns: vi.fn(), setWorldLayer: vi.fn(), setMarked: vi.fn(),
      dispose: vi.fn(), cancelPath: vi.fn(), lookAt: vi.fn(), setSpawnVisibility: vi.fn(), setActive: vi.fn(), setScenery: vi.fn(), setTool: vi.fn(), setFalloff: vi.fn(), target: () => ({ x: 0, y: 0, z: 0 }),
      spawnStatus: () => ({ capped: { creatures: false, objects: false }, error: null, loading: 0 }),
    };
    created.push(world);
    return world;
  },
}));

import { createAppStore } from '../../src/renderer/state/app-store';
import { AppShell } from '../../src/renderer/views/AppShell';
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
  render(<AppShell store={store} />);
  await waitFor(() => expect(store.getState().project.name).not.toBe(''));
  return { api, store };
}
afterEach(() => {
  created.length = 0;
  localStorage.clear();
  vi.unstubAllGlobals();
});
const tab = (name: string) => screen.getByRole('tab', { name });

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

  it('opens on the world, with the quests one tab away', async () => {
    await shell();
    expect(tab('World')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('region', { name: 'World' })).toBeVisible();
    await waitFor(() => expect(created).toHaveLength(1));
    expect(screen.queryByRole('button', { name: 'New quest' })).toBeNull();
  });

  it('switches to the quests and back without building the world again, and the world rests while hidden', async () => {
    await shell();
    await waitFor(() => expect(created).toHaveLength(1));
    await userEvent.click(tab('Quests'));
    expect(tab('Quests')).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findAllByTestId('quest-node')).toHaveLength(1);
    const tools = screen.getByRole('toolbar', { name: 'Quest tools' });
    for (const name of ['New quest', 'Add existing quest', 'Fit view']) expect(within(tools).getByRole('button', { name })).toBeInTheDocument();
    expect(created[0]!.setActive).toHaveBeenLastCalledWith(false);
    await userEvent.click(tab('World'));
    expect(created).toHaveLength(1);
    expect(created[0]!.dispose).not.toHaveBeenCalled();
    expect(created[0]!.setActive).toHaveBeenLastCalledWith(true);
  });

  it('moves between the tabs with the arrow keys', async () => {
    await shell();
    tab('World').focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(tab('Quests')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Quests')).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(tab('World')).toHaveAttribute('aria-selected', 'true');
  });

  it('brings the user to the quests when a quest opens', async () => {
    const { store } = await shell();
    await store.getState().openQuest(60001);
    await waitFor(() => expect(tab('Quests')).toHaveAttribute('aria-selected', 'true'));
  });

  it('starts a quest from the welcome on the quests tab', async () => {
    const { api } = await shell();
    // A project not greeted yet: the next time the world is shown, it is
    localStorage.clear();
    await userEvent.click(tab('Quests'));
    await userEvent.click(tab('World'));
    await userEvent.click(await screen.findByRole('button', { name: 'Start a quest' }));
    await waitFor(() => expect(api.newQuest).toHaveBeenCalled());
    expect(tab('Quests')).toHaveAttribute('aria-selected', 'true');
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
    expect(tab('Quests')).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(tab('World'));
    await userEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
  });

  it('starts the next quest of the chain from an NPC right-clicked in the world, with it as giver and ender, and shows it', async () => {
    const { store } = await shell();
    await store.getState().openQuest(60001);
    // Opening a quest shows the quests; back to the world, where it stays open
    await userEvent.click(tab('World'));
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
    expect(tab('Quests')).toHaveAttribute('aria-selected', 'true');
  });

  it('leaves the open quest alone when the new quest cannot be made', async () => {
    const { store } = await shell({ newQuest: async () => ({ ok: false, error: { code: 'UNKNOWN', message: 'no' } }) });
    await store.getState().openQuest(60001);
    await userEvent.click(tab('World'));
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
