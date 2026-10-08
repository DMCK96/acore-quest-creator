// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NamesProvider } from '../../src/renderer/state/names';
import { makeMockApi, okv } from './mock-api';
import { foundSpawns, FindDialog } from '../../src/renderer/world3d/FindDialog';

const worlds = vi.hoisted(() => [] as any[]);
vi.mock('../../src/renderer/world3d/world3d', () => ({
  createWorld3D: (options: any) => {
    const world = { options, map: options.map, dispose: vi.fn(), cancelPath: vi.fn(), lookAt: vi.fn(), select: vi.fn(), setDocks: vi.fn(), setDocksEnabled: vi.fn(), setMovementPlaying: vi.fn(), resetMovement: vi.fn(), frameOfSpawn: vi.fn(() => null), setSpawnVisibility: vi.fn(), setWorldLayer: vi.fn(), setOwnSpawns: vi.fn(), setPlacing: vi.fn(),
      setScenery: vi.fn(), setTool: vi.fn(), setFalloff: vi.fn(), target: () => ({ x: 0, y: 0, z: 0 }), spawnStatus: () => ({ capped: { creatures: false, objects: false }, error: null }) };
    worlds.push(world);
    return world;
  },
}));

import { WorldWorkspace } from '../../src/renderer/world3d/WorldWorkspace';

const workspace = () => (
  <WorldWorkspace hasClient projectKey="seen" projectName="" onOpenSettings={vi.fn()} onShowQuests={vi.fn()} onStartQuest={vi.fn()} />
);

beforeEach(() => localStorage.setItem('acqc.welcome.seen', JSON.stringify(['seen'])));
afterEach(() => { worlds.length = 0; localStorage.clear(); vi.unstubAllGlobals(); });
const clientHasEverything = () => vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1]), { status: 200 }));

const EMPTY = { spawns: [], routes: [], added: [] };
const dot = (guid: number, map: number, x: number, extra: object = {}) => ({ kind: 'creature' as const, guid, entry: 1423, name: 'Stormwind Guard', map, x, y: 0, z: 10, ...extra });
const hits = [{ id: 1423, name: 'Stormwind Guard', detail: 'Level 60' }];
// The camera starts at the Eastern Kingdoms' start; these stand near, far, on Kalimdor, and where the game has a dungeon
const spawns = [dot(1, 0, -5000), dot(2, 0, 100), dot(3, 1, 7), dot(4, 389, 1), dot(5, 0, 90, { event: { id: 12, name: "Hallow's End" } })];

async function open(overrides: Record<string, unknown> = {}) {
  clientHasEverything();
  const api = makeMockApi({
    worldLayer: vi.fn(async () => okv(EMPTY)),
    searchEntities: vi.fn(async () => okv(hits)),
    findSpawns: vi.fn(async () => okv({ spawns, capped: false })),
    ...overrides,
  });
  render(<NamesProvider api={api}>{workspace()}</NamesProvider>);
  await waitFor(() => expect(worlds).toHaveLength(1));
  await userEvent.click(screen.getByRole('button', { name: 'Find…' }));
  await userEvent.type(await screen.findByRole('searchbox', { name: 'Find by name or ID' }), 'guard');
  await userEvent.click(await screen.findByRole('button', { name: /Stormwind Guard/ }));
  return { api };
}

describe('listing the spawns of an NPC or object', () => {
  const from = { map: 0, x: 0, y: 0, z: 10 };

  it('puts the map being looked at first, nearest first, then the other maps in order', () => {
    const list = foundSpawns(spawns, EMPTY, 1423, 'creature', from);
    expect(list.map((s) => s.guid)).toEqual([5, 2, 1, 3, 4]);
  });

  it('lays the layer over the database: moved spawns where they now stand, placed ones added', () => {
    const layer = {
      spawns: [{ kind: 'creature' as const, guid: 1, entry: 1423, name: 'n', map: 0, original: { x: 0, y: 0, z: 0, orientation: 0, rotation: null }, current: { x: 50, y: 0, z: 10, orientation: 0, rotation: null } },
        { kind: 'gameobject' as const, guid: 2, entry: 1423, name: 'n', map: 0, original: { x: 0, y: 0, z: 0, orientation: 0, rotation: null }, current: { x: 1, y: 1, z: 1, orientation: 0, rotation: null } }],
      routes: [],
      added: [
        { kind: 'creature' as const, guid: 90001, entry: 1423, name: 'Stormwind Guard', map: 0, placement: { x: 10, y: 0, z: 10, orientation: 0, rotation: null }, look: { displayId: 1, scale: 1, equipment: [0, 0, 0] as [number, number, number], preset: null } },
        { kind: 'creature' as const, guid: 90002, entry: 7, name: 'Other', map: 0, placement: { x: 11, y: 0, z: 10, orientation: 0, rotation: null }, look: { displayId: 1, scale: 1, equipment: [0, 0, 0] as [number, number, number], preset: null } },
      ],
    };
    const list = foundSpawns(spawns, layer, 1423, 'creature', from);
    expect(list.map((s) => [s.guid, s.note, s.x])).toEqual([[90001, 'placed', 10], [1, 'moved', 50], [5, null, 90], [2, null, 100], [3, null, 7], [4, null, 1]].map(([g, n, x]) => [g, n, x]));
  });
});

describe('the find panel in the 3D screen', () => {
  it('lists the spawns with how far they are, what marks them, and no way to go to a map the view does not draw', async () => {
    const { api } = await open();
    expect(api.searchEntities).toHaveBeenCalledWith('creature', 'guard');
    expect(api.findSpawns).toHaveBeenCalledWith('creature', 1423);
    const rows = await screen.findAllByRole('listitem');
    expect(rows).toHaveLength(5);
    // Nearest to where the camera was put first: spawn 1 is a few thousand yards off, 2 and 5 are across the continent
    expect(within(rows[0]!).getByText(/Spawn 1 · Eastern Kingdoms/)).toBeTruthy();
    expect(within(rows[0]!).getByText(/3\d\d\d yards away/)).toBeTruthy();
    expect(within(rows[1]!).getByText(/Spawn 5/)).toBeTruthy();
    expect(within(rows[1]!).getByText(/only during Hallow's End/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go to spawn 4' })).toBeDisabled();
    expect(screen.getByText(/not drawn in 3D yet/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go to spawn 3' })).toBeEnabled();
  });

  it('takes the camera close to the spawn, selects it, and shows its card', async () => {
    await open();
    await userEvent.click(await screen.findByRole('button', { name: 'Go to spawn 2' }));
    expect(screen.queryByRole('dialog', { name: 'Find an NPC or object' })).toBeNull();
    await waitFor(() => expect(worlds[0].select).toHaveBeenLastCalledWith({ kind: 'creature', guid: 2 }));
    expect(worlds[0].lookAt).toHaveBeenLastCalledWith(100, 0, 11, true);
    expect(await screen.findByText('Stormwind Guard')).toBeTruthy();
    expect(screen.getByText('X 100.00 · Y 0.00 · Z 10.00')).toBeTruthy();
    expect(worlds).toHaveLength(1);
  });

  it('draws the world during its event when it goes to a spawn that appears only then', async () => {
    await open();
    await userEvent.click(await screen.findByRole('button', { name: 'Go to spawn 5' }));
    await waitFor(() => expect(worlds[0].setSpawnVisibility).toHaveBeenLastCalledWith(expect.objectContaining({ events: 12, creatures: true })));
    expect(screen.getByRole('combobox', { name: 'Event' })).toHaveDisplayValue("Hallow's End");
    expect(await screen.findByText(/Only during event 12: Hallow's End/)).toBeTruthy();
  });

  it('opens the other continent and brings the spawn into view once that world is there', async () => {
    await open();
    await userEvent.click(await screen.findByRole('button', { name: 'Go to spawn 3' }));
    await waitFor(() => expect(worlds).toHaveLength(2));
    expect(worlds[1].map).toBe(1);
    await waitFor(() => expect(worlds[1].select).toHaveBeenLastCalledWith({ kind: 'creature', guid: 3 }));
    expect(worlds[1].lookAt).toHaveBeenLastCalledWith(7, 0, 11, true);
    expect(worlds[0].select).not.toHaveBeenCalled();
  });

  it('goes to the same spawn again when picked again', async () => {
    await open();
    await userEvent.click(await screen.findByRole('button', { name: 'Go to spawn 2' }));
    await waitFor(() => expect(worlds[0].select).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole('button', { name: 'Find…' }));
    await userEvent.type(await screen.findByRole('searchbox', { name: 'Find by name or ID' }), 'guard');
    await userEvent.click(await screen.findByRole('button', { name: /Stormwind Guard/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Go to spawn 2' }));
    await waitFor(() => expect(worlds[0].select).toHaveBeenCalledTimes(2));
  });

  it('searches objects in the object table, and says when one has no spawns', async () => {
    clientHasEverything();
    const api = makeMockApi({
      worldLayer: vi.fn(async () => okv(EMPTY)),
      searchEntities: vi.fn(async () => okv([{ id: 143981, name: 'Mailbox' }])),
      findSpawns: vi.fn(async () => okv({ spawns: [], capped: false })),
    });
    render(<NamesProvider api={api}>{workspace()}</NamesProvider>);
    await waitFor(() => expect(worlds).toHaveLength(1));
    await userEvent.click(screen.getByRole('button', { name: 'Find…' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Object' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Find by name or ID' }), 'mail');
    await userEvent.click(await screen.findByRole('button', { name: /Mailbox/ }));
    expect(api.searchEntities).toHaveBeenCalledWith('gameobject', 'mail');
    expect(api.findSpawns).toHaveBeenCalledWith('gameobject', 143981);
    expect(await screen.findByText('This object has no spawns in the database.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: '‹ Back' }));
    expect(screen.getByRole('searchbox', { name: 'Find by name or ID' })).toBeTruthy();
  });

  it('closes on Esc, leaving the world under it', async () => {
    await open();
    await screen.findAllByRole('listitem');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Find an NPC or object' })).toBeNull();
    expect(screen.getByRole('region', { name: 'World' })).toBeInTheDocument();
  });

  it('says why when the spawns cannot be read', async () => {
    const { errv } = await import('./mock-api');
    await open({ findSpawns: vi.fn(async () => errv('NOT_CONNECTED', 'Connect to a world database first.')) });
    expect(await screen.findByText('Connect to a world database first.')).toBeTruthy();
  });
});

describe('finding a spawn group', () => {
  it("finds the map's spawn groups by name and goes to one", async () => {
    const view = { id: 32492, name: 'Path 1', map: 571, maxActive: 1, members: [{ key: 'npc:39203', type: 'spawn' as const, name: 'Drake', chance: 10, at: { x: 10, y: 0, z: 0 } }] };
    const api = makeMockApi({ worldGroupsOnMap: vi.fn(async () => okv([{ id: 32492, name: 'Path 1', maxActive: 1, members: 2, groups: [] }, { id: 32493, name: 'Path 2', maxActive: 1, members: 2, groups: [] }])),
      worldGroupView: vi.fn(async () => okv(view)) });
    const onGoToGroup = vi.fn();
    render(<NamesProvider api={api}><FindDialog from={{ map: 571, x: 0, y: 0, z: 0 }} onGo={vi.fn()} onGoToGroup={onGoToGroup} onClose={vi.fn()} /></NamesProvider>);
    await userEvent.click(screen.getByRole('radio', { name: 'Spawn group' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Find by name or ID' }), 'path 1');
    await userEvent.click(await screen.findByRole('button', { name: /Path 1 · 1 of 2 at a time/ }));
    await waitFor(() => expect(onGoToGroup).toHaveBeenCalledWith(view));
    expect(screen.queryByRole('button', { name: /Path 2/ })).toBeNull();
  });

  const drakes = [
    { id: 32491, name: 'Time-Lost Proto Drake / Vyragosa', maxActive: 1, members: 2, groups: [32492, 32493] },
    { id: 32492, name: 'Path 1', maxActive: 1, members: 2, groups: [] },
    { id: 32493, name: 'Path 2', maxActive: 1, members: 2, groups: [] },
  ];
  const openDrakes = async () => {
    const view = { id: 32493, name: 'Path 2', map: 571, maxActive: 1, members: [] };
    const api = makeMockApi({ worldGroupsOnMap: vi.fn(async () => okv(drakes)), worldGroupView: vi.fn(async () => okv(view)) });
    const onGoToGroup = vi.fn();
    render(<NamesProvider api={api}><FindDialog from={{ map: 571, x: 0, y: 0, z: 0 }} onGo={vi.fn()} onGoToGroup={onGoToGroup} onClose={vi.fn()} /></NamesProvider>);
    await userEvent.click(screen.getByRole('radio', { name: 'Spawn group' }));
    return { view, onGoToGroup };
  };

  it('lists a group inside a group under its mother, not also at the top', async () => {
    await openDrakes();
    const top = await screen.findByRole('list', { name: 'Matches' });
    const nestedList = await within(top).findByRole('list', { name: 'Groups in Time-Lost Proto Drake / Vyragosa' });
    expect(within(nestedList).getByRole('button', { name: /Path 1/ })).toBeTruthy();
    expect(within(nestedList).getByRole('button', { name: /Path 2/ })).toBeTruthy();
    expect(within(top).getAllByRole('button', { name: /Path 1/ })).toHaveLength(1);
  });

  it('shows a matching nested group under its mother, and goes to it', async () => {
    const { view, onGoToGroup } = await openDrakes();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Find by name or ID' }), 'path 2');
    const nestedList = await screen.findByRole('list', { name: 'Groups in Time-Lost Proto Drake / Vyragosa' });
    expect(screen.getByRole('button', { name: /Time-Lost Proto Drake/ })).toBeTruthy();
    expect(within(nestedList).queryByRole('button', { name: /Path 1/ })).toBeNull();
    await userEvent.click(within(nestedList).getByRole('button', { name: /Path 2/ }));
    await waitFor(() => expect(onGoToGroup).toHaveBeenCalledWith(view));
  });
});
