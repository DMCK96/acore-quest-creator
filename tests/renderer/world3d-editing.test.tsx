// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NamesProvider } from '../../src/renderer/state/names';
import { makeMockApi, okv, errv, sampleOpen } from './mock-api';
import { ENTITIES_FIELD, newNpc, newSpawn, readEntities, writeEntities } from '../../src/core/entities/model';
import { addPoint, newPatrol } from '../../src/core/map/patrol';

const worlds = vi.hoisted(() => [] as any[]);
vi.mock('../../src/renderer/world3d/world3d', () => ({
  createWorld3D: (options: any) => {
    const world = { options, dispose: vi.fn(), lookAt: vi.fn(), setSpawnVisibility: vi.fn(), setOwnSpawns: vi.fn(), select: vi.fn(),
      setWorldLayer: vi.fn(), setMode: vi.fn(), undo: vi.fn(), redo: vi.fn(),
      spawnStatus: () => ({ capped: { creatures: false, objects: false }, error: null }) };
    worlds.push(world);
    return world;
  },
}));
vi.mock('../../src/renderer/map/LeafletMap', () => ({ LeafletMap: () => <div /> }));

import { QuestMapView } from '../../src/renderer/map/QuestMapView';
import { World3DScreen } from '../../src/renderer/world3d/World3DScreen';

afterEach(() => { worlds.length = 0; vi.unstubAllGlobals(); });
const clientHasEverything = () => vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1]), { status: 200 }));
const EMPTY = { spawns: [], routes: [] };
const moved = { spawns: [{ kind: 'creature', guid: 80330, entry: 1423, name: 'Guard', map: 0, original: { x: 0, y: 0, z: 0, orientation: 0, rotation: null }, current: { x: 1, y: 2, z: 3, orientation: 0, rotation: null } }], routes: [] };
const place = (own: boolean, guid: number, entry: number) => ({ kind: 'place', spawn: { kind: 'creature', guid, entry, own }, to: { x: 1, y: 2, z: 3, orientation: 1.5, rotation: null } });

const patrol = addPoint(addPoint(newPatrol(9000), { x: 1, y: 1, z: 1 }), { x: 2, y: 2, z: 2 });
const hela = { ...newNpc(12000001), name: 'Hela', spawns: [{ ...newSpawn(900), map: 0, x: -8900, y: -160, z: 82, patrol: { ...patrol, points: patrol.points.map((p, i) => (i === 0 ? { ...p, waitSecs: 7 } : p)) } }] };
const open = () => { const base = sampleOpen(); return { ...base, aggregate: { ...base.aggregate, values: { ...base.aggregate.values, [ENTITIES_FIELD]: writeEntities({ npcs: [hela], objects: [], items: [] }) } } }; };

async function questMap(api = makeMockApi({ worldLayer: vi.fn(async () => okv(EMPTY)) })) {
  clientHasEverything();
  const onChange = vi.fn();
  render(<NamesProvider api={api}><QuestMapView open={open()} onChange={onChange} focusId={null} onClose={vi.fn()} hasClient /></NamesProvider>);
  await userEvent.click(await screen.findByRole('button', { name: '3D view' }));
  await waitFor(() => expect(worlds).toHaveLength(1));
  return { api, onChange, world: worlds[0] };
}

describe('editing in the quest map\'s 3D view', () => {
  it('turns an own NPC\'s placement into a quest edit', async () => {
    const { onChange, world } = await questMap();
    world.options.onEdit(place(true, 900, 12000001));
    const [field, value] = onChange.mock.calls.at(-1)!;
    expect(field).toBe(ENTITIES_FIELD);
    expect(readEntities({ [ENTITIES_FIELD]: value }).npcs[0]!.spawns[0]).toMatchObject({ x: 1, y: 2, z: 3, o: 1.5 });
  });

  it('turns an own route edit into the patrol, keeping each point\'s wait and giving a new point none', async () => {
    const { onChange, world } = await questMap();
    const points = readEntities(open().aggregate.values).npcs[0]!.spawns[0]!.patrol!.points;
    world.options.onEdit({ kind: 'route', spawn: { kind: 'creature', guid: 900, entry: 12000001, own: true }, pathId: 9000,
      points: [{ x: 1, y: 1, z: 1, carry: points[0] }, { x: 5, y: 5, z: 5 }, { x: 2, y: 2, z: 2, carry: points[1] }] });
    const [, value] = onChange.mock.calls.at(-1)!;
    const saved = readEntities({ [ENTITIES_FIELD]: value }).npcs[0]!.spawns[0]!.patrol!;
    expect(saved.pathId).toBe(9000);
    expect(saved.points.map((p) => [p.x, p.waitSecs])).toEqual([[1, 7], [5, 0], [2, 0]]);
  });

  it('sends an existing spawn\'s placement to the world layer and draws the layer it gets back', async () => {
    const worldMoveSpawn = vi.fn(async () => okv(moved));
    const { onChange, world } = await questMap(makeMockApi({ worldLayer: vi.fn(async () => okv(EMPTY)), worldMoveSpawn }));
    world.options.onEdit(place(false, 80330, 1423));
    await waitFor(() => expect(world.setWorldLayer).toHaveBeenLastCalledWith(moved));
    expect(worldMoveSpawn).toHaveBeenCalledWith('creature', 80330, { x: 1, y: 2, z: 3, orientation: 1.5, rotation: null });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'World changes (1)' })).toBeTruthy();
  });

  it('opens the World changes list from its button, and draws the layer a revert leaves', async () => {
    const worldChanges = vi.fn(async () => okv([{ ...moved.spawns[0], type: 'spawn', drifted: false }]));
    const worldRevert = vi.fn(async () => okv(EMPTY));
    const { world } = await questMap(makeMockApi({ worldLayer: vi.fn(async () => okv(moved)), worldChanges, worldRevert }));
    await userEvent.click(await screen.findByRole('button', { name: 'World changes (1)' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Revert Guard' }));
    await waitFor(() => expect(world.setWorldLayer).toHaveBeenLastCalledWith(EMPTY));
    expect(screen.getByRole('button', { name: 'World changes (0)' })).toBeDisabled();
  });

  it('shows where the selected spawn now stands after it is moved', async () => {
    const { world } = await questMap(makeMockApi({ worldLayer: vi.fn(async () => okv(EMPTY)), worldMoveSpawn: vi.fn(async () => okv(moved)) }));
    world.options.onSelect({ kind: 'creature', guid: 80330, entry: 1423, name: 'Guard', own: false, event: null, position: { x: 0, y: 0, z: 0 }, pathId: 0 });
    world.options.onEdit(place(false, 80330, 1423));
    expect(await screen.findByText('X 1.00 · Y 2.00 · Z 3.00')).toBeTruthy();
  });

  it('puts the spawn back and says why when the world edit fails', async () => {
    const { world } = await questMap(makeMockApi({ worldLayer: vi.fn(async () => okv(EMPTY)), worldMoveSpawn: vi.fn(async () => errv('NOT_CONNECTED', 'Connect to a world database first.')) }));
    world.options.onSelect({ kind: 'creature', guid: 80330, entry: 1423, name: 'Guard', own: false, event: null, position: { x: 0, y: 0, z: 0 }, pathId: 0 });
    world.options.onEdit(place(false, 80330, 1423));
    expect(await screen.findByText('Connect to a world database first.')).toBeTruthy();
    expect(world.setWorldLayer).toHaveBeenLastCalledWith(EMPTY);
  });

  it('asks before the first change to a route other spawns walk, once per route', async () => {
    const worldRoute = vi.fn(async () => okv({ points: [], walkers: 3 }));
    const { world } = await questMap(makeMockApi({ worldLayer: vi.fn(async () => okv(EMPTY)), worldRoute }));
    const guard = { kind: 'creature', guid: 80330, entry: 1423, own: false };
    const answer = world.options.beforeRouteEdit(guard, 802);
    expect(await screen.findByText('This route is walked by 3 spawns (path 802). Changing it changes it for all of them.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await expect(answer).resolves.toBe(true);
    await expect(world.options.beforeRouteEdit(guard, 802)).resolves.toBe(true);
    expect(worldRoute).toHaveBeenCalledTimes(1);
  });

  it('remembers Cancel as no for that route', async () => {
    const { world } = await questMap(makeMockApi({ worldLayer: vi.fn(async () => okv(EMPTY)), worldRoute: vi.fn(async () => okv({ points: [], walkers: 2 })) }));
    const guard = { kind: 'creature', guid: 80330, entry: 1423, own: false };
    const answer = world.options.beforeRouteEdit(guard, 803);
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await expect(answer).resolves.toBe(false);
    await expect(world.options.beforeRouteEdit(guard, 803)).resolves.toBe(false);
  });

  it('undo after a revert sends the earlier placement as a fresh world edit', async () => {
    const worldMoveSpawn = vi.fn(async () => okv(moved));
    const { world } = await questMap(makeMockApi({ worldLayer: vi.fn(async () => okv(EMPTY)), worldMoveSpawn }));
    // The world's history emits whole earlier states through onEdit; the view passes them on unchanged
    const earlier = { ...place(false, 80330, 1423), to: { x: 0, y: 0, z: 0, orientation: 0, rotation: null } };
    world.options.onEdit(earlier);
    await waitFor(() => expect(worldMoveSpawn).toHaveBeenLastCalledWith('creature', 80330, earlier.to));
  });

  it('asks the server for the floor nearest the dragged height', async () => {
    const { world } = await questMap(makeMockApi({ worldLayer: vi.fn(async () => okv(EMPTY)), mapFloors: vi.fn(async () => okv({ floors: [82.18, 98.12], ground: 82.1 })) }));
    await expect(world.options.floorZ(-8901, -161, 97)).resolves.toBe(98.12);
  });
});

describe('editing in the world 3D screen', () => {
  it('sends every spawn to the world layer, own or not', async () => {
    clientHasEverything();
    const worldMoveSpawn = vi.fn(async () => okv(moved));
    render(<NamesProvider api={makeMockApi({ worldLayer: vi.fn(async () => okv(EMPTY)), worldMoveSpawn })}><World3DScreen hasClient onClose={vi.fn()} /></NamesProvider>);
    await waitFor(() => expect(worlds).toHaveLength(1));
    worlds[0].options.onEdit({ ...place(false, 5, 143981), spawn: { kind: 'object', guid: 5, entry: 143981, own: false } });
    await waitFor(() => expect(worldMoveSpawn).toHaveBeenCalledWith('gameobject', 5, expect.anything()));
  });
});
