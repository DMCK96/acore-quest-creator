// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NamesProvider } from '../../src/renderer/state/names';
import { ProjectEntitiesProvider } from '../../src/renderer/state/project-entities';
import { makeMockApi, okv } from './mock-api';
import { clearClipboard } from '../../src/renderer/world3d/clipboard';
import { EMPTY_ENTITIES, newNpc, newSpawn, type ProjectEntities } from '../../src/core/entities/model';
import { markWelcomeSeen } from '../../src/renderer/world3d/welcome-seen';
import { setClientMaps, type WorldMap } from '../../src/core/map/world-maps';
import { LAST_PLACE_KEY, writeLastPlace } from '../../src/renderer/world3d/last-place';
import { NODE_STOP, type TaxiNode } from '../../src/core/game/taxi-path';
import { frameOfView, routeLinesOf } from '../../src/core/map/transport-view';
import { placementToLocal, toWorld } from '../../src/core/map/transport-frame';

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

type Props = { goTo?: { map: number; x: number; y: number; z: number; nonce: number }; focus?: { questId: number; part: { kind: 'creature'; entry: number }; nonce: number; at: number } };

function mount({ map = zeppelin(), overrides = {}, entities = EMPTY_ENTITIES, tracked = [] }: { map?: WorldMap; overrides?: Record<string, unknown>; entities?: ProjectEntities; tracked?: unknown[] } = {}) {
  vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1]), { status: 200 }));
  api = makeMockApi({ worldLayer: vi.fn(async () => okv({ spawns: [], routes: [], added: [] })),
    mapFloors: vi.fn(async () => okv({ floors: [31], ground: 31 })),
    worldMoveSpawn: vi.fn(async () => okv({ spawns: [], routes: [], added: [] })),
    worldSetRoute: vi.fn(async () => okv({ spawns: [], routes: [], added: [] })),
    viewSpawns: vi.fn(async () => okv({ creatures: [], objects: [], capped: { creatures: false, objects: false } })),
    clientMaps: vi.fn(async () => okv([map])) as any, ...overrides });
  const value = { entities, setEntities: vi.fn(), quests: [], layer: { spawns: [], routes: [], added: [] }, setLayer: vi.fn(), tracked,
    create: vi.fn(async () => ({ error: 'no' })), remove: vi.fn(async () => null), adopt: vi.fn(async () => ({ error: 'no' })), ensure: vi.fn(async () => null) } as any;
  const ui = (props: Props) => (
    <NamesProvider api={api}>
      <ProjectEntitiesProvider value={value}>
        <WorldWorkspace hasClient projectKey="p" projectName="P" onOpenSettings={vi.fn()} onShowQuests={vi.fn()} onStartQuest={vi.fn()} goTo={props.goTo} focus={props.focus as any} now={() => 0} />
      </ProjectEntitiesProvider>
    </NamesProvider>
  );
  const view = render(ui({}));
  return { rerender: (props: Props) => view.rerender(ui(props)) };
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

  it('reopens a saved stop once the client\'s maps are read, though it was left on a transport', async () => {
    writeLastPlace({ map: 591, x: 2000, y: 300, z: 40, transport: { template: 175080, node: 2 } });
    mount();
    await waitFor(() => expect(worlds.at(-1)?.options.map).toBe(591));
    expect(worlds.at(-1).options).toMatchObject({ hostMap: 0, directory: 'azeroth', start: { x: 2000, y: 300, z: 40 } });
    expect((screen.getByLabelText('Stop') as HTMLSelectElement).value).toBe('2');
    expect(JSON.parse(localStorage.getItem(LAST_PLACE_KEY)!)).toMatchObject({ map: 591, transport: { template: 175080, node: 2 } });
  });

  it('leaves the map alone when the author chose another before the client\'s maps came', async () => {
    writeLastPlace({ map: 591, x: 2000, y: 300, z: 40, transport: { template: 175080, node: 2 } });
    let answer!: (value: unknown) => void;
    mount({ overrides: { clientMaps: vi.fn(() => new Promise((resolve) => (answer = resolve))) } });
    await waitFor(() => expect(worlds).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Coordinates' }));
    fireEvent.change(screen.getByLabelText('Map'), { target: { value: '1' } });
    await waitFor(() => expect(worlds.at(-1).options.map).toBe(1));
    answer(okv([zeppelin()]));
    await new Promise((r) => setTimeout(r, 20));
    expect(worlds.at(-1).options.map).toBe(1);
  });

  it('changes the route without reading the passengers again', async () => {
    mount({ map: zeppelin(2) });
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

  it('never asks the server for a floor on a vessel: the deck is the floor, so a drag there says nothing of the server', async () => {
    mount();
    const world = await chooseZeppelin();
    expect(world.options.floorZ).toBeUndefined();
    expect(api.mapFloors).not.toHaveBeenCalled();
  });
});

describe('going to a passenger', () => {
  /** A passenger two yards forward of the vessel's middle, a yard up */
  const deck = { x: 2, y: 0, z: 1 };
  const atStop = (node: number) => toWorld(frameOfView(zeppelin(), { template: 175080, node }), deck);
  const closeTo = (p: { x: number; y: number; z: number }) => ({ x: expect.closeTo(p.x, 4), y: expect.closeTo(p.y, 4), z: expect.closeTo(p.z, 4) });
  const lookedAtClose = (world: any, p: { x: number; y: number; z: number }) =>
    expect(world.lookAt).toHaveBeenLastCalledWith(expect.closeTo(p.x, 4), expect.closeTo(p.y, 4), expect.closeTo(p.z + 1, 4), true);
  const hand = { kind: 'creature' as const, guid: 9, entry: 1423, name: 'Deckhand', map: 591, ...deck };

  async function find(): Promise<void> {
    await userEvent.click(screen.getByRole('button', { name: 'Find…' }));
    await userEvent.type(await screen.findByRole('searchbox', { name: 'Find by name or ID' }), 'deck');
    await userEvent.click(await screen.findByRole('button', { name: /Deckhand/ }));
  }
  const finding = () => ({ searchEntities: vi.fn(async () => okv([{ id: 1423, name: 'Deckhand' }])), findSpawns: vi.fn(async () => okv({ spawns: [hand], capped: false })) });

  it('Find opens the transport at its dock and aims at the passenger on its deck', async () => {
    mount({ overrides: finding() });
    await waitFor(() => expect(worlds).toHaveLength(1));
    await find();
    const go = await screen.findByRole('button', { name: 'Go to spawn 9' });
    await waitFor(() => expect(go).toBeEnabled());
    await userEvent.click(go);
    await waitFor(() => expect(worlds.at(-1).options.map).toBe(591));
    const world = worlds.at(-1);
    expect(world.options.start).toEqual(closeTo(atStop(0)));
    await waitFor(() => expect(world.select).toHaveBeenLastCalledWith({ kind: 'creature', guid: 9 }));
    lookedAtClose(world, atStop(0));
    // The card keeps the stored, vessel-local place
    expect(screen.getByText('X 2.00 · Y 0.00 · Z 1.00')).toBeTruthy();
  });

  it('Find on the open transport aims through the stop shown, measuring from the deck', async () => {
    mount({ overrides: finding() });
    const world = await chooseZeppelin();
    fireEvent.change(screen.getByLabelText('Stop'), { target: { value: '1' } });
    await waitFor(() => expect(world.setTransport).toHaveBeenCalled());
    await find();
    const row = (await screen.findByRole('button', { name: 'Go to spawn 9' })).closest('li')!;
    expect(within(row as HTMLElement).getByText(/· 2 yards away/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Go to spawn 9' }));
    await waitFor(() => expect(world.select).toHaveBeenLastCalledWith({ kind: 'creature', guid: 9 }));
    lookedAtClose(world, atStop(1));
    expect(worlds.at(-1)).toBe(world);
  });

  it('the undo note\'s Show goes to a passenger\'s place on its vessel', async () => {
    const view = mount();
    await waitFor(() => expect(worlds).toHaveLength(1));
    await waitFor(() => expect(api.clientMaps).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    view.rerender({ goTo: { map: 591, ...deck, nonce: 1 } });
    await waitFor(() => expect(worlds.at(-1).options.map).toBe(591));
    expect(worlds.at(-1).options.start).toEqual(closeTo(atStop(0)));
  });

  it('following the focus to a passenger aims at it on its vessel', async () => {
    const view = mount({ overrides: { questSpawnList: vi.fn(async () => okv([{ questId: 60001, title: 'Q', spawns: [{ ...hand, role: 'giver' }], capped: false, cut: 0 }])) } });
    await waitFor(() => expect(worlds).toHaveLength(1));
    view.rerender({ focus: { questId: 60001, part: { kind: 'creature', entry: 1423 }, nonce: 1, at: 10 } });
    await waitFor(() => expect(worlds.at(-1).options.map).toBe(591));
    const world = worlds.at(-1);
    expect(world.options.start).toEqual(closeTo(atStop(0)));
    await waitFor(() => expect(world.select).toHaveBeenCalledWith({ kind: 'creature', guid: 9 }));
    lookedAtClose(world, atStop(0));
  });

  it('Project changes\' Go to aims at a project passenger on its vessel', async () => {
    const entities = { ...EMPTY_ENTITIES, npcs: [{ ...newNpc(12000001), name: 'Hela', spawns: [{ ...newSpawn(6000001), map: 591, ...deck }] }] };
    const tracked = [{ kind: 'npc', entry: 12000001, name: 'Hela', origin: 'new', changes: ['new'], usedBy: [], goTo: { kind: 'creature', guid: 6000001, map: 591, ...deck } }];
    mount({ entities, tracked });
    await waitFor(() => expect(worlds).toHaveLength(1));
    await waitFor(() => expect(api.clientMaps).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    await userEvent.click(screen.getByRole('button', { name: /Project changes/ }));
    await userEvent.click(within(screen.getByRole('listitem', { name: 'Hela' })).getByRole('button', { name: 'Go to' }));
    await waitFor(() => expect(worlds.at(-1).options.map).toBe(591));
    const world = worlds.at(-1);
    expect(world.options.start).toEqual(closeTo(atStop(0)));
    await waitFor(() => expect(world.select).toHaveBeenCalledWith({ kind: 'creature', guid: 6000001 }));
    lookedAtClose(world, atStop(0));
  });

  it('Find\'s spawn group on the transport aims at its members on the deck', async () => {
    const group = { id: 1, name: 'Crew', map: 591, maxActive: 1, members: [{ key: 'npc:9', type: 'spawn' as const, name: 'Deckhand', chance: 100, at: deck }] };
    mount({ overrides: { worldGroupsOnMap: vi.fn(async () => okv([{ id: 1, name: 'Crew', maxActive: 1, members: 1, groups: [] }])), worldGroupView: vi.fn(async () => okv(group)) } });
    const world = await chooseZeppelin();
    await userEvent.click(screen.getByRole('button', { name: 'Find…' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Spawn group' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Find by name or ID' }), 'crew');
    await userEvent.click(await screen.findByRole('button', { name: /Crew/ }));
    await waitFor(() => expect(world.select).toHaveBeenCalledWith({ kind: 'creature', guid: 9 }));
    lookedAtClose(world, atStop(0));
  });
});
