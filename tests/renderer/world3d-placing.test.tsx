// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NamesProvider } from '../../src/renderer/state/names';
import { makeMockApi, okv, errv, sampleOpen } from './mock-api';

const worlds = vi.hoisted(() => [] as any[]);
vi.mock('../../src/renderer/world3d/world3d', () => ({
  createWorld3D: (options: any) => {
    const world = { options, dispose: vi.fn(), lookAt: vi.fn(), setSpawnVisibility: vi.fn(), setOwnSpawns: vi.fn(), select: vi.fn(),
      setWorldLayer: vi.fn(), setMode: vi.fn(), setPlacing: vi.fn(), undo: vi.fn(), redo: vi.fn(),
      setActive: vi.fn(), setScenery: vi.fn(), target: () => ({ x: 0, y: 0, z: 0 }), spawnStatus: () => ({ capped: { creatures: false, objects: false }, error: null }) };
    worlds.push(world);
    return world;
  },
}));
vi.mock('../../src/renderer/map/LeafletMap', () => ({ LeafletMap: () => <div /> }));

import { QuestMapView } from '../../src/renderer/map/QuestMapView';

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
  render(<NamesProvider api={api}><QuestMapView open={sampleOpen()} onChange={vi.fn()} focusId={null} onClose={vi.fn()} hasClient /></NamesProvider>);
  await userEvent.click(await screen.findByRole('button', { name: '3D view' }));
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
    expect(screen.getByRole('button', { name: 'World changes (1)' })).toBeTruthy();
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
