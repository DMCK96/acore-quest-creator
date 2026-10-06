// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NamesProvider } from '../../src/renderer/state/names';
import { ProjectEntitiesProvider } from '../../src/renderer/state/project-entities';
import { makeMockApi, okv } from './mock-api';
import { clearClipboard } from '../../src/renderer/world3d/clipboard';
import { EMPTY_ENTITIES, newNpc, newObject, newSpawn, type ProjectEntities } from '../../src/core/entities/model';
import { markWelcomeSeen } from '../../src/renderer/world3d/welcome-seen';
import { writeLastPlace } from '../../src/renderer/world3d/last-place';

const worlds = vi.hoisted(() => [] as any[]);
vi.mock('../../src/renderer/world3d/world3d', () => ({
  createWorld3D: (options: any) => {
    const canvas = document.createElement('canvas');
    canvas.tabIndex = 0;
    options.container.appendChild(canvas);
    const world = { options, canvas, dispose: vi.fn(), lookAt: vi.fn(), setSpawnVisibility: vi.fn(), setOwnSpawns: vi.fn(), select: vi.fn(), selectSpawns: vi.fn(),
      setWorldLayer: vi.fn(), setMode: vi.fn(), setPlacing: vi.fn(), cancelDrag: vi.fn(), setMarked: vi.fn(),
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

const at = { x: 10, y: 20, z: 30 };
const crate = { ...newObject(9100001), name: 'Crate', displayId: 1, spawns: [{ ...newSpawn(7000001), x: 1, y: 2, z: 3 }] };
const crateSpawn = { kind: 'object' as const, guid: 7000001, entry: 9100001, name: 'Crate', own: true, added: false, pathId: 0, wander: 0, map: 0, placement: { x: 1, y: 2, z: 3, orientation: 0, rotation: null } };

const dbGoober = { ...newObject(181000), name: 'Lever', displayId: 2, origin: { kind: 'existing' as const, original: {}, sharedLoot: 0, spawnCount: 1, locked: [] as ('type' | 'loot' | 'fight')[] } };
const dbGooberSpawn = { kind: 'object' as const, guid: 55, entry: 181000, name: 'Lever', own: false, added: false, pathId: 0, wander: 0, map: 0, group: null, respawnSecs: 300, objectType: 10, placement: { x: 1, y: 2, z: 3, orientation: 0, rotation: null } };

function mount(entities: ProjectEntities = EMPTY_ENTITIES) {
  vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1]), { status: 200 }));
  const api = makeMockApi({ worldLayer: vi.fn(async () => okv({ spawns: [], routes: [], added: [] })), allocateIds: vi.fn(async () => okv([6000007])),
    mapFloors: vi.fn(async () => okv({ floors: [31], ground: 31 })) });
  const state = { entities };
  const setEntities = vi.fn((next: ProjectEntities) => { state.entities = next; });
  const create = vi.fn(async () => ({ entry: 12000007 }));
  const adopt = vi.fn(async (kind: string, entry: number) => {
    const origin = { kind: 'existing' as const, original: {}, sharedLoot: 0, spawnCount: 1, locked: [] };
    if (kind === 'object') state.entities = { ...state.entities, objects: [...state.entities.objects, { ...dbGoober, entry, origin }] };
    else state.entities = { ...state.entities, npcs: [...state.entities.npcs, { ...newNpc(entry), name: 'Stormwind Guard', origin }] };
    return { entry };
  });
  const ensure = vi.fn(async (ref: { kind: string; entry: number }) => {
    const owned = [...state.entities.npcs, ...state.entities.objects, ...state.entities.items].some((e) => e.entry === ref.entry);
    if (owned) return null;
    const result = await adopt(ref.kind, ref.entry);
    return 'error' in result ? (result as { error: string }).error : null;
  });
  const value = () => ({ entities: state.entities, setEntities, quests: [], layer: { spawns: [], routes: [], added: [] }, setLayer: vi.fn(), tracked: state.entities.objects.map((o) => ({ kind: 'object' as const, entry: o.entry, name: o.name, origin: 'new' as const, changes: ['new' as const], usedBy: [], goTo: o.spawns[0] ? { kind: 'object' as const, guid: o.spawns[0].guid, map: o.spawns[0].map, x: o.spawns[0].x, y: o.spawns[0].y, z: o.spawns[0].z } : null })), create, remove: vi.fn(async () => null), adopt, ensure });
  const ui = () => (
    <NamesProvider api={api}>
      <ProjectEntitiesProvider value={value()}>
        <WorldWorkspace hasClient projectKey="p" projectName="P" onOpenSettings={vi.fn()} onShowQuests={vi.fn()} onStartQuest={vi.fn()} />
      </ProjectEntitiesProvider>
    </NamesProvider>
  );
  const view = render(ui());
  return { api, create, adopt, ensure, setEntities, rerender: () => view.rerender(ui()) };
}
const rightClick = (target: any) => act(() => worlds.at(-1).options.onContextMenu(target, { x: 40, y: 40 }));

beforeEach(() => {
  worlds.length = 0;
  clearClipboard();
  markWelcomeSeen('p');
  writeLastPlace({ map: 0, x: 0, y: 0, z: 0 });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('creating and editing from the World view', () => {
  it('a project NPC offers Edit', async () => {
    const hela = { ...newNpc(12000001), name: 'Hela', displayId: 1, spawns: [{ ...newSpawn(6000001), x: 1, y: 2, z: 3 }] };
    mount({ ...EMPTY_ENTITIES, npcs: [hela] });
    await waitFor(() => expect(worlds).toHaveLength(1));
    const own = { kind: 'creature' as const, guid: 6000001, entry: 12000001, name: 'Hela', own: true, added: false, pathId: 0, wander: 0, map: 0, placement: { x: 1, y: 2, z: 3, orientation: 0, rotation: null } };
    rightClick({ ground: at, hit: { type: 'spawn', spawn: own }, selection: [own] });
    expect(screen.getByRole('menuitem', { name: 'Edit NPC…' })).toBeTruthy();
  });

  it('Edit NPC on a database NPC brings it into the project and opens its editor', async () => {
    const { adopt } = mount();
    await waitFor(() => expect(worlds).toHaveLength(1));
    const guard = { kind: 'creature' as const, guid: 80330, entry: 1423, name: 'Stormwind Guard', own: false, added: false, pathId: 0, wander: 0, map: 0, placement: { x: 1, y: 2, z: 3, orientation: 0, rotation: null } };
    rightClick({ ground: at, hit: { type: 'spawn', spawn: guard }, selection: [guard] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit NPC…' }));
    await waitFor(() => expect(adopt).toHaveBeenCalledWith('npc', 1423));
  });

  it('New NPC here makes an NPC with one spawn where it was clicked, outside any quest, then opens its editor', async () => {
    const { create } = mount();
    await waitFor(() => expect(worlds).toHaveLength(1));
    rightClick({ ground: at, hit: null, selection: [] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'New NPC here…' }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    const [kind, preset, ...rest] = create.mock.calls[0] as any[];
    expect(kind).toBe('npc');
    expect(rest).toEqual([]);
    expect(preset.spawns).toEqual([expect.objectContaining({ guid: 6000007, map: 0, x: 10, y: 20 })]);
  });

  it('Make lootable turns a project object into a lootable one and opens its contents', async () => {
    const { setEntities } = mount({ ...EMPTY_ENTITIES, objects: [crate] });
    await waitFor(() => expect(worlds).toHaveLength(1));
    rightClick({ ground: at, hit: { type: 'spawn', spawn: crateSpawn }, selection: [crateSpawn] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Make lootable…' }));
    await waitFor(() => expect(setEntities).toHaveBeenCalledWith({ ...EMPTY_ENTITIES, objects: [{ ...crate, type: 'chest' }] }));
  });

  it('Make lootable asks first when the object has pages, and does nothing on no', async () => {
    const book = { ...crate, type: 'text' as const, pages: [{ id: 1, text: 'x' }] };
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { setEntities } = mount({ ...EMPTY_ENTITIES, objects: [book] });
    await waitFor(() => expect(worlds).toHaveLength(1));
    rightClick({ ground: at, hit: { type: 'spawn', spawn: crateSpawn }, selection: [crateSpawn] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Make lootable…' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith('Make Crate lootable? Its pages are not shown once it can be looted.'));
    expect(setEntities).not.toHaveBeenCalled();
  });

  it('Stop being lootable makes it usable again and keeps its loot', async () => {
    const loot = [{ item: 1, chance: 100, min: 1, max: 1, questOnly: false }];
    const chest = { ...crate, type: 'chest' as const, loot };
    const { setEntities } = mount({ ...EMPTY_ENTITIES, objects: [chest] });
    await waitFor(() => expect(worlds).toHaveLength(1));
    rightClick({ ground: at, hit: { type: 'spawn', spawn: crateSpawn }, selection: [crateSpawn] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Stop being lootable' }));
    await waitFor(() => expect(setEntities).toHaveBeenCalledWith({ ...EMPTY_ENTITIES, objects: [{ ...chest, type: 'goober' }] }));
  });

  it('Make lootable on a database goober brings it into the project, then makes it a chest, as one step', async () => {
    const { api, adopt, ensure, setEntities } = mount();
    (api.readExistingEntity as any).mockResolvedValue(okv(dbGoober));
    await waitFor(() => expect(worlds).toHaveLength(1));
    rightClick({ ground: at, hit: { type: 'spawn', spawn: dbGooberSpawn }, selection: [dbGooberSpawn] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Make lootable…' }));
    await waitFor(() => expect(setEntities).toHaveBeenCalledWith({ ...EMPTY_ENTITIES, objects: [{ ...dbGoober, type: 'chest' }] }));
    expect(ensure).toHaveBeenCalledWith({ kind: 'object', entry: 181000 });
    expect(adopt).toHaveBeenCalledWith('object', 181000);
    expect(adopt.mock.invocationCallOrder[0]!).toBeLessThan(setEntities.mock.invocationCallOrder[0]!);
  });

  it('Make lootable on a database object whose type is locked brings nothing in and says why', async () => {
    const { api, adopt, setEntities } = mount();
    (api.readExistingEntity as any).mockResolvedValue(okv({ ...dbGoober, origin: { ...dbGoober.origin, locked: ['type'] } }));
    await waitFor(() => expect(worlds).toHaveLength(1));
    rightClick({ ground: at, hit: { type: 'spawn', spawn: dbGooberSpawn }, selection: [dbGooberSpawn] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Make lootable…' }));
    await waitFor(() => expect(screen.getByText(/Lever's type cannot be changed/)).toBeTruthy());
    expect(adopt).not.toHaveBeenCalled();
    expect(setEntities).not.toHaveBeenCalled();
  });

  it('Make lootable on a database object asks first when it has pages, and brings nothing in on no', async () => {
    const { api, adopt, setEntities } = mount();
    (api.readExistingEntity as any).mockResolvedValue(okv({ ...dbGoober, type: 'text', pages: [{ id: 1, text: 'x' }] }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await waitFor(() => expect(worlds).toHaveLength(1));
    rightClick({ ground: at, hit: { type: 'spawn', spawn: dbGooberSpawn }, selection: [dbGooberSpawn] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Make lootable…' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith('Make Lever lootable? Its pages are not shown once it can be looted.'));
    expect(adopt).not.toHaveBeenCalled();
    expect(setEntities).not.toHaveBeenCalled();
  });

  it('Edit object opens the editor on a project object', async () => {
    mount({ ...EMPTY_ENTITIES, objects: [crate] });
    await waitFor(() => expect(worlds).toHaveLength(1));
    rightClick({ ground: at, hit: { type: 'spawn', spawn: crateSpawn }, selection: [crateSpawn] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit object…' }));
    expect(await screen.findByRole('dialog', { name: 'Object: Crate' })).toBeTruthy();
  });

  it('draws every project spawn with no quest open', async () => {
    mount({ ...EMPTY_ENTITIES, objects: [crate] });
    await waitFor(() => expect(worlds).toHaveLength(1));
    await waitFor(() => expect(worlds[0].setOwnSpawns).toHaveBeenCalledWith(expect.objectContaining({ objects: [expect.objectContaining({ guid: 7000001, own: true })] })));
  });

  it('Project changes edits a project object and goes to its spawn', async () => {
    mount({ ...EMPTY_ENTITIES, objects: [crate] });
    await waitFor(() => expect(worlds).toHaveLength(1));
    await userEvent.click(await screen.findByRole('button', { name: 'Project changes (1)' }));
    const row = screen.getByRole('listitem', { name: 'Crate' });
    await userEvent.click(within(row).getByRole('button', { name: 'Go to' }));
    expect(screen.queryByRole('dialog', { name: 'Project changes' })).toBeNull();
    await waitFor(() => expect(worlds.at(-1).select).toHaveBeenCalledWith({ kind: 'object', guid: 7000001 }));
    await userEvent.click(screen.getByRole('button', { name: 'Project changes (1)' }));
    await userEvent.click(within(screen.getByRole('listitem', { name: 'Crate' })).getByRole('button', { name: 'Edit' }));
    expect(await screen.findByRole('dialog', { name: 'Object: Crate' })).toBeTruthy();
  });
});
