// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NamesProvider } from '../../src/renderer/state/names';
import { createAppStore } from '../../src/renderer/state/app-store';
import { HistoryProvider } from '../../src/renderer/state/history-context';
import { ProjectEntitiesProvider } from '../../src/renderer/state/project-entities';
import { EMPTY_ENTITIES, newNpc } from '../../src/core/entities/model';
import { makeMockApi, okv, errv } from './mock-api';

const worlds = vi.hoisted(() => [] as any[]);
vi.mock('../../src/renderer/world3d/world3d', () => ({
  createWorld3D: (options: any) => {
    const world = { options, dispose: vi.fn(), cancelPath: vi.fn(), lookAt: vi.fn(), setSpawnVisibility: vi.fn(), setOwnSpawns: vi.fn(), select: vi.fn(),
      setWorldLayer: vi.fn(), setMode: vi.fn(), setPlacing: vi.fn(), cancelDrag: vi.fn(),
      setScenery: vi.fn(), setTool: vi.fn(), setFalloff: vi.fn(), groundAt: vi.fn(() => ({ x: 10, y: 0, z: 2 })),
      camera: () => ({ position: { x: 10, y: 5, z: 40 }, direction: { x: 0, y: 0, z: -1 } }), target: () => ({ x: 0, y: 0, z: 0 }), spawnStatus: () => ({ capped: { creatures: false, objects: false }, error: null }) };
    worlds.push(world);
    return world;
  },
}));

import { World3DView } from '../../src/renderer/world3d/World3DView';
import { CHAIN_DRAG_TYPE, encodePart } from '../../src/renderer/world3d/chain-drop';

afterEach(() => { worlds.length = 0; vi.unstubAllGlobals(); });
const clientHasEverything = () => vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1]), { status: 200 }));
const EMPTY = { spawns: [], routes: [], added: [] };
const look = { displayId: 1, scale: 1, equipment: [0, 0, 0] as [number, number, number], preset: null };
const at = { x: 1, y: 2, z: 3, orientation: 1.5, rotation: null };
const placed = { ...EMPTY, added: [{ kind: 'creature', guid: 90001, entry: 1423, name: 'Stormwind Guard', map: 0, placement: at, look }] };
const hits = (kind: string) => (kind === 'creature' ? [{ id: 1423, name: 'Stormwind Guard', detail: 'Level 60' }] : [{ id: 143981, name: 'Mailbox' }]);

async function threeD(overrides: Record<string, unknown> = {}) {
  clientHasEverything();
  const api = makeMockApi({
    worldLayer: vi.fn(async () => okv(EMPTY)),
    searchEntities: vi.fn(async (kind: string) => okv(hits(kind))),
    worldAddSpawn: vi.fn(async () => okv({ layer: placed, guid: 90001 })),
    worldRevert: vi.fn(async () => okv(EMPTY)),
    ...overrides,
  });
  render(<NamesProvider api={api}><HistoryProvider store={createAppStore(api)}><World3DView map={0} start={{ x: 0, y: 0, z: 0 }} hasClient /></HistoryProvider></NamesProvider>);
  await waitFor(() => expect(worlds).toHaveLength(1));
  return { api, world: worlds[0] };
}

const choose = async (what: 'NPC' | 'Object', text: string, hit: string) => {
  await userEvent.click(screen.getByRole('button', { name: 'Place…' }));
  await userEvent.click(await screen.findByRole('radio', { name: what }));
  await userEvent.type(screen.getByRole('searchbox', { name: 'Find by name or ID' }), text);
  await userEvent.click(await screen.findByRole('button', { name: new RegExp(hit) }));
};

describe('placing an existing NPC or object from the 3D view', () => {
  it('searches NPCs, and starts placing the one picked', async () => {
    const { api, world } = await threeD();
    await choose('NPC', 'guard', 'Stormwind Guard');
    expect(api.searchEntities).toHaveBeenCalledWith('creature', 'guard');
    expect(world.setPlacing).toHaveBeenLastCalledWith({ kind: 'creature', entry: 1423 });
    expect(screen.queryByRole('dialog', { name: 'Place an NPC or object' })).toBeNull();
    expect(screen.getByText(/Placing Stormwind Guard \(#1423\)/)).toBeTruthy();
  });

  it('searches objects in the object table', async () => {
    const { api, world } = await threeD();
    await choose('Object', 'mail', 'Mailbox');
    expect(api.searchEntities).toHaveBeenCalledWith('gameobject', 'mail');
    expect(world.setPlacing).toHaveBeenLastCalledWith({ kind: 'object', entry: 143981 });
  });

  it('says when nothing matches', async () => {
    await threeD({ searchEntities: vi.fn(async () => okv([])) });
    await userEvent.click(screen.getByRole('button', { name: 'Place…' }));
    await userEvent.type(await screen.findByRole('searchbox', { name: 'Find by name or ID' }), 'zzz');
    expect(await screen.findByText('Nothing in the database matches.')).toBeTruthy();
  });

  it('adds the spawn a click placed to the world layer, draws it and selects it', async () => {
    const { api, world } = await threeD();
    await choose('NPC', 'guard', 'Stormwind Guard');
    world.options.onPlace({ target: { kind: 'creature', entry: 1423 }, at });
    await waitFor(() => expect(world.setWorldLayer).toHaveBeenLastCalledWith(placed));
    expect(api.worldAddSpawn).toHaveBeenCalledWith('creature', 1423, expect.any(Number), at);
    expect(world.select).toHaveBeenLastCalledWith({ kind: 'creature', guid: 90001 });
    expect(await screen.findByText('Stormwind Guard')).toBeTruthy();
    expect(screen.getByText(/Placed here; it is not in the database/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Project changes (1)' })).toBeTruthy();
  });

  it('sends an object to the gameobject table', async () => {
    const { api, world } = await threeD();
    await choose('Object', 'mail', 'Mailbox');
    world.options.onPlace({ target: { kind: 'object', entry: 143981 }, at });
    await waitFor(() => expect(api.worldAddSpawn).toHaveBeenCalledWith('gameobject', 143981, expect.any(Number), at));
  });

  it('removes a placed spawn from its card', async () => {
    const { api, world } = await threeD();
    await choose('NPC', 'guard', 'Stormwind Guard');
    world.options.onPlace({ target: { kind: 'creature', entry: 1423 }, at });
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(api.worldRevert).toHaveBeenCalledWith({ kind: 'spawn', spawnKind: 'creature', guid: 90001 });
    await waitFor(() => expect(world.setWorldLayer).toHaveBeenLastCalledWith(EMPTY));
    expect(screen.queryByLabelText('Selected spawn')).toBeNull();
  });

  it('says why when the spawn could not be placed, and draws nothing', async () => {
    const { world } = await threeD({ worldAddSpawn: vi.fn(async () => errv('BAD_REQUEST', 'NPC 1423 is not in the database.')) });
    await choose('NPC', 'guard', 'Stormwind Guard');
    world.options.onPlace({ target: { kind: 'creature', entry: 1423 }, at });
    expect(await screen.findByText('NPC 1423 is not in the database.')).toBeTruthy();
    expect(world.select).not.toHaveBeenCalled();
  });

  it('stops placing when Esc is pressed in the view, or Done is pressed', async () => {
    const { world } = await threeD();
    await choose('NPC', 'guard', 'Stormwind Guard');
    world.options.onPlaceEnd();
    await waitFor(() => expect(screen.queryByText(/click the ground to put one down/)).toBeNull());
    expect(world.setPlacing).toHaveBeenLastCalledWith(null);
    await choose('NPC', 'guard', 'Stormwind Guard');
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(world.setPlacing).toHaveBeenLastCalledWith(null);
  });
});

describe('dropping a quest’s NPC or object from the chain onto the 3D view', () => {
  async function view(overrides: Record<string, unknown> = {}) {
    clientHasEverything();
    const api = makeMockApi({ worldLayer: vi.fn(async () => okv(EMPTY)), worldAddSpawn: vi.fn(async () => okv({ layer: placed, guid: 90001 })), ...overrides });
    render(<NamesProvider api={api}><HistoryProvider store={createAppStore(api)}><World3DView map={0} start={{ x: 0, y: 0, z: 0 }} hasClient /></HistoryProvider></NamesProvider>);
    await waitFor(() => expect(worlds).toHaveLength(1));
    return { api, world: worlds[0], stage: document.querySelector('.world3d__stage')! };
  }
  const transfer = (data: string, types = [CHAIN_DRAG_TYPE]) => ({ types, getData: (type: string) => (types.includes(type) ? data : ''), dropEffect: 'none' });
  const guard = encodePart({ kind: 'creature', entry: 1423 });
  // jsdom has no DragEvent, so the pointer's place is put on the plain event the drag falls back to
  const drag = (type: 'dragOver' | 'drop', target: Element, dataTransfer: object): boolean => {
    const event = createEvent[type](target, { dataTransfer });
    Object.defineProperties(event, { clientX: { value: 50 }, clientY: { value: 60 } });
    return fireEvent(target, event);
  };

  it('accepts a part dragged over the ground, as a copy', async () => {
    const { stage } = await view();
    const dataTransfer = transfer(guard);
    expect(drag('dragOver', stage, dataTransfer)).toBe(false);
    expect(dataTransfer.dropEffect).toBe('copy');
  });

  it('refuses a drag over the sky, and anything that is not a part', async () => {
    const { world, stage } = await view();
    expect(drag('dragOver', stage, transfer('x', ['text/plain']))).toBe(true);
    world.groundAt.mockReturnValue(null);
    expect(drag('dragOver', stage, transfer(guard))).toBe(true);
  });

  it('places the dropped part where it lands, facing the camera, as one step', async () => {
    const { api, world, stage } = await view();
    drag('drop', stage, transfer(guard));
    expect(world.groundAt).toHaveBeenLastCalledWith({ x: 50, y: 60 });
    await waitFor(() => expect(api.worldAddSpawn).toHaveBeenCalledWith('creature', 1423, 0, expect.objectContaining({ x: 10, y: 0, z: 2 })));
    await waitFor(() => expect(world.select).toHaveBeenLastCalledWith({ kind: 'creature', guid: 90001 }));
    expect(api.historyBegin).toHaveBeenCalledTimes(1);
    expect(api.historyEnd).toHaveBeenCalledTimes(1);
  });

  it('places nothing, and adds no step, for a drop on the sky', async () => {
    const { api, world, stage } = await view();
    world.groundAt.mockReturnValue(null);
    drag('drop', stage, transfer(guard));
    await new Promise((r) => setTimeout(r, 20));
    expect(api.worldAddSpawn).not.toHaveBeenCalled();
    expect(api.historyBegin).not.toHaveBeenCalled();
  });

  describe('of the project’s own NPC, which the database does not have yet', () => {
    const hela = { ...newNpc(12000001), name: 'Hela' };
    async function ownView(allocateIds = vi.fn(async () => okv([900]))) {
      clientHasEverything();
      const api = makeMockApi({ worldLayer: vi.fn(async () => okv(EMPTY)), allocateIds });
      const onOwnEdit = vi.fn(() => true);
      const project = { entities: { ...EMPTY_ENTITIES, npcs: [hela] }, setEntities: vi.fn(), quests: [], layer: EMPTY, setLayer: vi.fn(), tracked: [], create: vi.fn(), remove: vi.fn(), adopt: vi.fn(), ensure: vi.fn(async () => null) } as any;
      render(<NamesProvider api={api}><ProjectEntitiesProvider value={project}><HistoryProvider store={createAppStore(api)}>
        <World3DView map={0} start={{ x: 0, y: 0, z: 0 }} hasClient onOwnEdit={onOwnEdit} />
      </HistoryProvider></ProjectEntitiesProvider></NamesProvider>);
      await waitFor(() => expect(worlds).toHaveLength(1));
      return { api, world: worlds[0], onOwnEdit, stage: document.querySelector('.world3d__stage')! };
    }

    it('gives it a spawn of its own, with a new guid, as one step, and selects it', async () => {
      const { api, world, onOwnEdit, stage } = await ownView();
      drag('drop', stage, transfer(encodePart({ kind: 'creature', entry: 12000001 })));
      await waitFor(() => expect(onOwnEdit).toHaveBeenCalled());
      expect(api.allocateIds).toHaveBeenCalledWith('creatureSpawn', 1);
      expect(onOwnEdit).toHaveBeenCalledWith({
        kind: 'presence', spawn: { kind: 'creature', guid: 900, entry: 12000001, own: true }, present: true, map: 0, at: expect.objectContaining({ x: 10, y: 0, z: 2 }),
      });
      expect(api.worldAddSpawn).not.toHaveBeenCalled();
      await waitFor(() => expect(world.select).toHaveBeenLastCalledWith({ kind: 'creature', guid: 900 }));
      expect(await screen.findByText('Hela')).toBeTruthy();
      expect(api.historyBegin).toHaveBeenCalledTimes(1);
      expect(api.historyEnd).toHaveBeenCalledTimes(1);
    });

    it('places one with each click while placing it, too', async () => {
      const { world, onOwnEdit } = await ownView();
      world.options.onPlace({ target: { kind: 'creature', entry: 12000001 }, at });
      await waitFor(() => expect(onOwnEdit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'presence', spawn: expect.objectContaining({ guid: 900, own: true }), at })));
    });

    it('says why when no spawn guid could be had, and places nothing', async () => {
      const { world, onOwnEdit, stage } = await ownView(vi.fn(async () => okv([])));
      drag('drop', stage, transfer(encodePart({ kind: 'creature', entry: 12000001 })));
      expect(await screen.findByText('No free spawn ID could be found.')).toBeTruthy();
      expect(onOwnEdit).not.toHaveBeenCalled();
      expect(world.select).not.toHaveBeenCalled();
    });
  });

  it('says why a part with no template could not be placed', async () => {
    const { world, stage } = await view({ worldAddSpawn: vi.fn(async () => errv('BAD_REQUEST', 'NPC 1423 is not in the database.')) });
    drag('drop', stage, transfer(guard));
    expect(await screen.findByText('NPC 1423 is not in the database.')).toBeTruthy();
    expect(world.select).not.toHaveBeenCalled();
  });
});
