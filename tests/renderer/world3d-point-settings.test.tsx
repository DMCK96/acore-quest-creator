// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NamesProvider } from '../../src/renderer/state/names';
import { ProjectEntitiesProvider } from '../../src/renderer/state/project-entities';
import { EMPTY_ENTITIES, newNpc, newSpawn, type ProjectEntities } from '../../src/core/entities/model';
import { newPatrol, newPatrolPoint } from '../../src/core/map/patrol';
import { makeMockApi, okv } from './mock-api';

const worlds = vi.hoisted(() => [] as any[]);
vi.mock('../../src/renderer/world3d/world3d', () => ({
  createWorld3D: (options: any) => {
    const canvas = document.createElement('canvas');
    canvas.tabIndex = 0;
    options.container.appendChild(canvas);
    const world = { options, canvas, dispose: vi.fn(), lookAt: vi.fn(), setSpawnVisibility: vi.fn(), setOwnSpawns: vi.fn(), select: vi.fn(), selectSpawns: vi.fn(),
      setWorldLayer: vi.fn(), setMode: vi.fn(), setPlacing: vi.fn(), cancelDrag: vi.fn(), setMarked: vi.fn(), setLooks: vi.fn(), setGroupSpawns: vi.fn(), setGroupView: vi.fn(),
      setScenery: vi.fn(), setTool: vi.fn(), setFalloff: vi.fn(), setPendingMovement: vi.fn(), spawnMovement: vi.fn(() => null),
      startPath: vi.fn(), finishPath: vi.fn(), cancelPath: vi.fn(), undoPoint: vi.fn(), selectedSpawns: vi.fn(() => []), groundAt: vi.fn(() => null), lastPointer: vi.fn(() => null),
      spawnOf: vi.fn(() => null), routeOf: vi.fn(() => null),
      camera: () => ({ position: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }),
      target: () => ({ x: 0, y: 0, z: 0 }), spawnStatus: () => ({ capped: { creatures: false, objects: false }, error: null }) };
    worlds.push(world);
    return world;
  },
}));

import { World3DView } from '../../src/renderer/world3d/World3DView';
import { HistoryProvider } from '../../src/renderer/state/history-context';
import { createAppStore } from '../../src/renderer/state/app-store';

const EMPTY = { spawns: [], routes: [], added: [] };
const placement = { x: 10, y: 0, z: 5, orientation: 1, rotation: null };
const spawnInfo = (guid: number, entry: number, own: boolean) => ({ kind: 'creature' as const, guid, entry, name: 'Guard', own, added: false, pathId: 777, wander: 0, map: 0, respawnSecs: 300, group: null, placement });

afterEach(() => {
  worlds.length = 0;
  vi.unstubAllGlobals();
});

async function view(entities: ProjectEntities = EMPTY_ENTITIES) {
  vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1]), { status: 200 }));
  const api = makeMockApi({
    worldLayer: vi.fn(async () => okv(EMPTY)),
    worldRoute: vi.fn(async () => okv({ points: [], walkers: 1 })),
    worldSetRoute: vi.fn(async () => okv(EMPTY)),
  });
  const onOwnEdit = vi.fn(() => true);
  const value = { entities, setEntities: vi.fn(), quests: [], layer: EMPTY, setLayer: vi.fn(), tracked: [], create: vi.fn(), remove: vi.fn(), adopt: vi.fn(), ensure: vi.fn(async () => null) } as any;
  render(
    <NamesProvider api={api}>
      <ProjectEntitiesProvider value={value}>
        <HistoryProvider store={createAppStore(api)}>
          <World3DView map={0} start={{ x: 0, y: 0, z: 0 }} hasClient onOwnEdit={onOwnEdit} />
        </HistoryProvider>
      </ProjectEntitiesProvider>
    </NamesProvider>,
  );
  await waitFor(() => expect(worlds).toHaveLength(1));
  return { api, world: worlds[0], onOwnEdit };
}
const rightClickPoint = (world: any, guid: number, index: number) =>
  act(() => world.options.onContextMenu({ ground: null, hit: { type: 'point', guid, index }, selection: [] }, { x: 40, y: 40 }));

describe('a route point\'s settings in the 3D view', () => {
  it('change a database route point\'s wait and pace, as one route edit that keeps its other columns', async () => {
    const { api, world } = await view();
    const rest = { delay: '0', move_type: '0', orientation: null, action: '12', action_chance: '100' };
    world.spawnOf.mockReturnValue(spawnInfo(80330, 1423, false));
    world.routeOf.mockReturnValue({ pathId: 777, points: [{ x: 1, y: 2, z: 3, carry: rest }, { x: 4, y: 5, z: 6, carry: rest }] });
    rightClickPoint(world, 80330, 1);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Point settings…' }));

    const dialog = screen.getByRole('dialog', { name: 'Point 2' });
    // The waypoint script it runs is named, not edited
    expect(within(dialog).getByText(/waypoint script 12/)).toBeInTheDocument();
    const wait = within(dialog).getByLabelText('Wait (seconds)');
    await userEvent.clear(wait);
    await userEvent.type(wait, '5');
    await userEvent.selectOptions(within(dialog).getByLabelText('Pace'), 'Run from here');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(api.worldSetRoute).toHaveBeenCalled());
    const [pathId, points] = (api.worldSetRoute as any).mock.calls[0];
    expect(pathId).toBe(777);
    expect(points[0]).toEqual({ x: 1, y: 2, z: 3, rest });
    expect(points[1]).toEqual({ x: 4, y: 5, z: 6, rest: { ...rest, delay: '5000', move_type: '1' } });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('give a project NPC\'s patrol point a wait and an action, through the patrol', async () => {
    const patrol = { ...newPatrol(80), points: [newPatrolPoint({ x: 1, y: 2, z: 3 }), newPatrolPoint({ x: 4, y: 5, z: 6 })] };
    const npc = { ...newNpc(12000001), name: 'Guard', spawns: [{ ...newSpawn(7000001), patrol }] };
    const { world, onOwnEdit } = await view({ ...EMPTY_ENTITIES, npcs: [npc] });
    world.spawnOf.mockReturnValue(spawnInfo(7000001, 12000001, true));
    world.routeOf.mockReturnValue({ pathId: 80, points: patrol.points.map((p) => ({ x: p.x, y: p.y, z: p.z, carry: p })) });
    rightClickPoint(world, 7000001, 0);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Point settings…' }));

    const dialog = screen.getByRole('dialog', { name: 'Point 1' });
    const wait = within(dialog).getByLabelText('Wait (seconds)');
    await userEvent.clear(wait);
    await userEvent.type(wait, '3');
    await userEvent.selectOptions(within(dialog).getByLabelText('Actions'), 'Say something');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(onOwnEdit).toHaveBeenCalled());
    const edit = (onOwnEdit.mock.calls as any[][]).map(([e]) => e).find((e) => e.kind === 'route');
    expect(edit).toMatchObject({ kind: 'route', pathId: 80, spawn: { guid: 7000001, own: true } });
    expect(edit.points[0].carry).toMatchObject({ waitSecs: 3, actions: [{ kind: 'say' }] });
    // The other point is as it was
    expect(edit.points[1].carry).toEqual(patrol.points[1]);
  });

  it('give a project NPC\'s patrol point an object to use, by its spawn and object', async () => {
    const patrol = { ...newPatrol(80), points: [newPatrolPoint({ x: 1, y: 2, z: 3 }), newPatrolPoint({ x: 4, y: 5, z: 6 })] };
    const npc = { ...newNpc(12000001), name: 'Guard', spawns: [{ ...newSpawn(7000001), patrol }] };
    const { api, world, onOwnEdit } = await view({ ...EMPTY_ENTITIES, npcs: [npc] });
    vi.mocked(api.searchEntities).mockResolvedValue(okv([{ id: 143981, name: 'Lever' }]));
    world.spawnOf.mockReturnValue(spawnInfo(7000001, 12000001, true));
    world.routeOf.mockReturnValue({ pathId: 80, points: patrol.points.map((p) => ({ x: p.x, y: p.y, z: p.z, carry: p })) });
    rightClickPoint(world, 7000001, 1);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Point settings…' }));

    const dialog = screen.getByRole('dialog', { name: 'Point 2' });
    await userEvent.selectOptions(within(dialog).getByLabelText('Actions'), 'Use an object');
    const uses = within(dialog).getByRole('group', { name: 'Uses an object' });
    await userEvent.type(within(uses).getByLabelText('Spawn (guid)'), '55001');
    await userEvent.type(within(uses).getByRole('combobox', { name: 'Object' }), 'lev');
    await userEvent.click(await within(uses).findByRole('option', { name: /Lever/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(onOwnEdit).toHaveBeenCalled());
    const edit = (onOwnEdit.mock.calls as any[][]).map(([e]) => e).find((e) => e.kind === 'route');
    expect(edit.points[1].carry.actions).toEqual([{ id: 'a1', afterSecs: 0, kind: 'useObject', guid: 55001, entry: 143981 }]);
    expect(edit.points[0].carry).toEqual(patrol.points[0]);
  });

});
