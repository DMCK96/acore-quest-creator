// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NamesProvider } from '../../src/renderer/state/names';
import { ProjectEntitiesProvider } from '../../src/renderer/state/project-entities';
import { makeMockApi, okv } from './mock-api';
import { clearClipboard } from '../../src/renderer/world3d/clipboard';
import { EMPTY_ENTITIES } from '../../src/core/entities/model';
import { markWelcomeSeen } from '../../src/renderer/world3d/welcome-seen';
import { setClientMaps, type WorldMap } from '../../src/core/map/world-maps';
import { writeLastPlace } from '../../src/renderer/world3d/last-place';
import { NODE_STOP, type TaxiNode } from '../../src/core/game/taxi-path';
import { frameOfView, routeLinesOf } from '../../src/core/map/transport-view';
import { placementToLocal } from '../../src/core/map/transport-frame';

const worlds = vi.hoisted(() => [] as any[]);
vi.mock('../../src/renderer/world3d/world3d', () => ({
  createWorld3D: (options: any) => {
    const canvas = document.createElement('canvas');
    canvas.tabIndex = 0;
    options.container.appendChild(canvas);
    const world = { options, canvas, dispose: vi.fn(), lookAt: vi.fn(), setSpawnVisibility: vi.fn(), setOwnSpawns: vi.fn(), select: vi.fn(), selectSpawns: vi.fn(),
      setWorldLayer: vi.fn(), setMode: vi.fn(), setPlacing: vi.fn(), cancelDrag: vi.fn(), setMarked: vi.fn(), setTransport: vi.fn(),
      setScenery: vi.fn(), setTool: vi.fn(), setFalloff: vi.fn(), setPendingMovement: vi.fn(), spawnMovement: vi.fn(() => ({ type: 'idle', wander: 0, pathId: null })),
      startPath: vi.fn(), finishPath: vi.fn(), cancelPath: vi.fn(), undoPoint: vi.fn(), selectedSpawns: vi.fn(() => []), groundAt: vi.fn(() => null), lastPointer: vi.fn(() => null),
      spawnOf: vi.fn(() => ({})), routeOf: vi.fn(() => null),
      camera: () => ({ position: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }),
      target: () => ({ x: 0, y: 0, z: 0 }), spawnStatus: () => ({ capped: { creatures: false, objects: false }, error: null }) };
    worlds.push(world);
    return world;
  },
}));

import { WorldWorkspace } from '../../src/renderer/world3d/WorldWorkspace';

const node = (index: number, map: number, x: number, y: number, flags = 0): TaxiNode => ({ index, map, x, y, z: 40, flags, delay: 0 });
/** Orgrimmar's dock on Kalimdor, a point past it, then a stop on the Eastern Kingdoms */
const route302 = [node(0, 1, 1300, -4600, NODE_STOP), node(1, 1, 1300, -4500), node(2, 0, 2000, 300, NODE_STOP), node(3, 0, 2100, 300)];
const route303 = [node(0, 1, 1500, -4700, NODE_STOP), node(1, 1, 1600, -4700)];
const zeppelin = (templates = 1): WorldMap => ({
  id: 591, name: 'Zeppelin', directory: 'kalimdor', kind: 'transport', start: { x: 1300, y: -4600, z: 40 },
  transport: {
    templates: [{ entry: 175080, name: 'Orgrimmar to Undercity', displayId: 3031, pathId: 302 }, { entry: 175081, name: 'Second run', displayId: 3032, pathId: 303 }].slice(0, templates),
    paths: { 302: route302, 303: route303 },
  },
});

let api: ReturnType<typeof makeMockApi>;

function mount(map: WorldMap = zeppelin()) {
  vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1]), { status: 200 }));
  api = makeMockApi({ worldLayer: vi.fn(async () => okv({ spawns: [], routes: [], added: [] })),
    mapFloors: vi.fn(async () => okv({ floors: [31], ground: 31 })),
    worldMoveSpawn: vi.fn(async () => okv({ spawns: [], routes: [], added: [] })),
    worldSetRoute: vi.fn(async () => okv({ spawns: [], routes: [], added: [] })),
    viewSpawns: vi.fn(async () => okv({ creatures: [], objects: [], capped: { creatures: false, objects: false } })),
    clientMaps: vi.fn(async () => okv([map])) as any });
  const value = { entities: EMPTY_ENTITIES, setEntities: vi.fn(), quests: [], layer: { spawns: [], routes: [], added: [] }, setLayer: vi.fn(), tracked: [],
    create: vi.fn(async () => ({ error: 'no' })), remove: vi.fn(async () => null), adopt: vi.fn(async () => ({ error: 'no' })), ensure: vi.fn(async () => null) };
  render(
    <NamesProvider api={api}>
      <ProjectEntitiesProvider value={value}>
        <WorldWorkspace hasClient projectKey="p" projectName="P" onOpenSettings={vi.fn()} onShowQuests={vi.fn()} onStartQuest={vi.fn()} />
      </ProjectEntitiesProvider>
    </NamesProvider>,
  );
}

/** Picks the zeppelin in the Coordinates form's map picker, under Transports */
async function chooseZeppelin(): Promise<any> {
  await waitFor(() => expect(worlds).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: 'Coordinates' }));
  const picker = screen.getByLabelText('Map') as HTMLSelectElement;
  await waitFor(() => expect(picker.querySelector('optgroup[label="Transports"] option[value="591"]')).toBeTruthy());
  fireEvent.change(picker, { target: { value: '591' } });
  await waitFor(() => expect(worlds.at(-1).options.map).toBe(591));
  return worlds.at(-1);
}

const placeEdit = { kind: 'place', spawn: { kind: 'creature', guid: 7, entry: 3, own: false }, to: { x: 1300, y: -4590, z: 41, orientation: 2, rotation: null } };
const box = { minX: -1, maxX: 1, minY: -1, maxY: 1 };

beforeEach(() => {
  worlds.length = 0;
  clearClipboard();
  markWelcomeSeen('p');
  writeLastPlace({ map: 0, x: 0, y: 0, z: 0 });
});
afterEach(() => {
  setClientMaps([]);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a transport in the World', () => {
  it('opens docked on its host continent, with its vessel, route and passengers', async () => {
    mount();
    const world = await chooseZeppelin();
    const map = zeppelin();
    const view = { template: 175080, node: 0 };
    expect(world.options).toMatchObject({ map: 591, hostMap: 1, directory: 'kalimdor', vessel: { displayId: 3031 } });
    expect(world.options.frame).toEqual(frameOfView(map, view));
    expect(world.options.route).toEqual(routeLinesOf(map, view));
    expect(world.options.route[0].stops.map((s: { node: number }) => s.node)).toEqual([0]);
    await world.options.spawns(world.options.map, box);
    expect(api.viewSpawns).toHaveBeenCalled();
    for (const [spawnMap] of vi.mocked(api.viewSpawns).mock.calls) expect(spawnMap).toBe(591);
  });

  it('moves the vessel to a stop on the same continent, and opens another continent for a stop there', async () => {
    mount();
    const world = await chooseZeppelin();
    fireEvent.change(screen.getByLabelText('Stop'), { target: { value: '1' } });
    await waitFor(() => expect(world.setTransport).toHaveBeenCalled());
    expect(world.setTransport).toHaveBeenLastCalledWith(expect.objectContaining({ frame: frameOfView(zeppelin(), { template: 175080, node: 1 }), vessel: { displayId: 3031 } }));
    expect(worlds.at(-1)).toBe(world);
    fireEvent.change(screen.getByLabelText('Stop'), { target: { value: '2' } });
    await waitFor(() => expect(worlds.at(-1).options.directory).toBe('azeroth'));
    expect(worlds.at(-1).options).toMatchObject({ map: 591, hostMap: 0 });
  });

  it('changes the route without reading the passengers again', async () => {
    mount(zeppelin(2));
    const world = await chooseZeppelin();
    await world.options.spawns(world.options.map, box);
    const asked = vi.mocked(api.viewSpawns).mock.calls.length;
    const passengers = world.setOwnSpawns.mock.calls.length;
    fireEvent.change(screen.getByLabelText('Route'), { target: { value: '175081' } });
    await waitFor(() => expect(world.setTransport).toHaveBeenLastCalledWith(expect.objectContaining({ vessel: { displayId: 3032 } })));
    expect(worlds.at(-1)).toBe(world);
    expect(world.setOwnSpawns).toHaveBeenCalledTimes(passengers);
    expect(api.viewSpawns).toHaveBeenCalledTimes(asked);
  });

  it('saves an edit made on the deck vessel-local, leaves a continent edit alone, and drops a walking path', async () => {
    mount();
    await waitFor(() => expect(worlds).toHaveLength(1));
    worlds[0].options.onGesture([placeEdit]);
    await waitFor(() => expect(api.worldMoveSpawn).toHaveBeenCalledWith('creature', 7, placeEdit.to));
    const world = await chooseZeppelin();
    world.options.onGesture([placeEdit]);
    const local = placementToLocal(world.options.frame, placeEdit.to);
    await waitFor(() => expect(api.worldMoveSpawn).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.worldMoveSpawn).mock.calls[1]).toEqual(['creature', 7, local]);
    world.options.onGesture([{ kind: 'route', spawn: placeEdit.spawn, pathId: 5, points: [{ x: 1, y: 2, z: 3 }] }]);
    await new Promise((r) => setTimeout(r, 20));
    expect(api.worldSetRoute).not.toHaveBeenCalled();
  });

  it('never asks the server for a floor on a vessel', async () => {
    mount();
    const world = await chooseZeppelin();
    await expect(world.options.floorZ(1300, -4600, 40)).resolves.toBeNull();
    expect(api.mapFloors).not.toHaveBeenCalled();
  });
});
