// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NamesProvider } from '../../src/renderer/state/names';
import { ProjectEntitiesProvider } from '../../src/renderer/state/project-entities';
import { makeMockApi, okv } from './mock-api';
import { clearClipboard } from '../../src/renderer/world3d/clipboard';
import { EMPTY_ENTITIES, newObject, newSpawn, type ProjectEntities } from '../../src/core/entities/model';
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
      setActive: vi.fn(), setScenery: vi.fn(), setTool: vi.fn(), setFalloff: vi.fn(), setPendingMovement: vi.fn(), spawnMovement: vi.fn(() => ({ type: 'idle', wander: 0, pathId: null })),
      startPath: vi.fn(), finishPath: vi.fn(), cancelPath: vi.fn(), undoPoint: vi.fn(), selectedSpawns: vi.fn(() => []), groundAt: vi.fn(() => null), lastPointer: vi.fn(() => null),
      hasSpawn: vi.fn(() => true), routeOf: vi.fn(() => null),
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

function mount(entities: ProjectEntities = EMPTY_ENTITIES) {
  vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1]), { status: 200 }));
  const api = makeMockApi({ worldLayer: vi.fn(async () => okv({ spawns: [], routes: [], added: [] })), allocateIds: vi.fn(async () => okv([6000007])),
    mapFloors: vi.fn(async () => okv({ floors: [31], ground: 31 })) });
  const state = { entities };
  const setEntities = vi.fn((next: ProjectEntities) => { state.entities = next; });
  const create = vi.fn(async () => ({ entry: 12000007 }));
  const value = () => ({ entities: state.entities, setEntities, quests: [], create, remove: vi.fn(async () => null) });
  const ui = () => (
    <NamesProvider api={api}>
      <ProjectEntitiesProvider value={value()}>
        <WorldWorkspace hasClient projectKey="p" projectName="P" onOpenSettings={vi.fn()} onShowQuests={vi.fn()} onStartQuest={vi.fn()} />
      </ProjectEntitiesProvider>
    </NamesProvider>
  );
  const view = render(ui());
  return { api, create, setEntities, rerender: () => view.rerender(ui()) };
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
