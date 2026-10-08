// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NamesProvider } from '../../src/renderer/state/names';
import { ProjectEntitiesProvider } from '../../src/renderer/state/project-entities';
import { HistoryProvider } from '../../src/renderer/state/history-context';
import { createAppStore } from '../../src/renderer/state/app-store';
import { EMPTY_ENTITIES, newNpc, newSpawn } from '../../src/core/entities/model';
import { emptyFight } from '../../src/core/combat/model';
import { SCRIPTS_FIELD, readScenes, writeScenes, type QuestScene } from '../../src/core/scripts/model';
import { PlaceInWorldProvider, useAsideForWorld } from '../../src/renderer/world3d/ShowInWorldContext';
import { makeMockApi, okv, sampleOpen } from './mock-api';

const worlds = vi.hoisted(() => [] as any[]);
vi.mock('../../src/renderer/world3d/world3d', () => ({
  createWorld3D: (options: any) => {
    const world = { options, dispose: vi.fn(), cancelPath: vi.fn(), lookAt: vi.fn(), setDocks: vi.fn(), setDocksEnabled: vi.fn(), setMovementPlaying: vi.fn(), resetMovement: vi.fn(), frameOfSpawn: vi.fn(() => null), setSpawnVisibility: vi.fn(), setOwnSpawns: vi.fn(), select: vi.fn(),
      setWorldLayer: vi.fn(), setMode: vi.fn(), setPlacing: vi.fn(), cancelDrag: vi.fn(), setScenery: vi.fn(), setTool: vi.fn(), setFalloff: vi.fn(),
      spawnOf: vi.fn(() => null), selectedSpawns: vi.fn(() => []), setMarked: vi.fn(), setMarkers: vi.fn(), selectMarker: vi.fn(() => true),
      camera: () => ({ position: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }), target: () => ({ x: 0, y: 0, z: 0 }),
      spawnStatus: () => ({ capped: { creatures: false, objects: false }, error: null }) };
    worlds.push(world);
    return world;
  },
}));

import { WorldWorkspace } from '../../src/renderer/world3d/WorldWorkspace';

const EMPTY = { spawns: [], routes: [], added: [] };
const at = (x: number, y: number, z = 5) => ({ x, y, z, o: 1 });
const hela = {
  ...newNpc(12000005), name: 'Hela', spawns: [{ ...newSpawn(900), map: 0, x: 30, y: 40, z: 5 }],
  fight: { ...emptyFight(), reactions: [{ id: 'r1', when: { kind: 'healthBelow' as const, pct: 50 }, phases: [], steps: [{ kind: 'summonAdds' as const, entry: 7, count: 1, at: at(50, 60), attack: false, waitMs: 0 }] }] },
};
const scenes: QuestScene[] = [
  { id: 's1', name: 'Walk', owner: { kind: 'creature', entry: 12000005 }, trigger: { kind: 'questAccepted' }, gates: [], steps: [{ kind: 'moveTo', at: at(31, 41), waitMs: 0 }] },
  { id: 's2', name: 'Cave', owner: { kind: 'areatrigger', id: 0, area: { map: 489, x: 1, y: 1, z: 1, radius: 5 } }, trigger: { kind: 'enterArea' }, gates: [], steps: [] },
];
const quest = { open: sampleOpen({ aggregate: { ...sampleOpen().aggregate, values: { [SCRIPTS_FIELD]: writeScenes(scenes) } } }), nodes: [] };

afterEach(() => {
  worlds.length = 0;
  vi.unstubAllGlobals();
  localStorage.clear();
});

async function workspace(props: Partial<React.ComponentProps<typeof WorldWorkspace>> = {}) {
  vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1]), { status: 200 }));
  localStorage.setItem('acqc.welcome.seen', JSON.stringify(['k']));
  const api = makeMockApi({ worldLayer: vi.fn(async () => okv(EMPTY)) });
  const project = { entities: { ...EMPTY_ENTITIES, npcs: [hela] }, setEntities: vi.fn(), quests: [], layer: EMPTY, setLayer: vi.fn(), tracked: [], create: vi.fn(), remove: vi.fn(), adopt: vi.fn(), ensure: vi.fn(async () => null) } as any;
  const onRequestEnd = vi.fn();
  const onQuestField = vi.fn();
  const ui = (more: Partial<React.ComponentProps<typeof WorldWorkspace>>) => (
    <NamesProvider api={api}><ProjectEntitiesProvider value={project}><HistoryProvider store={createAppStore(api)}>
      <WorldWorkspace hasClient projectKey="k" projectName="North" onOpenSettings={vi.fn()} onShowQuests={vi.fn()} onStartQuest={vi.fn()}
        quest={quest} onQuestField={onQuestField} onRequestEnd={onRequestEnd} {...props} {...more} />
    </HistoryProvider></ProjectEntitiesProvider></NamesProvider>
  );
  const { rerender } = render(ui({}));
  await waitFor(() => expect(worlds.length).toBeGreaterThan(0));
  return { api, project, world: worlds.at(-1), onRequestEnd, onQuestField, rerender: (more: Partial<React.ComponentProps<typeof WorldWorkspace>>) => rerender(ui(more)) };
}

describe('the open quest’s positions in the World', () => {
  it('are drawn as markers on the map shown, and taken away once the quest closes', async () => {
    const { world, rerender } = await workspace();
    await waitFor(() => expect(world.setMarkers).toHaveBeenCalled());
    const ids = world.setMarkers.mock.lastCall[0].map((m: { id: string }) => m.id).sort();
    // The cave's area is on another map; Hela's own spawn is drawn as a spawn
    expect(ids).toEqual(['fight:12000005:r1:0', 'scene:s1:0:at']);
    rerender({ quest: undefined });
    await waitFor(() => expect(world.setMarkers).toHaveBeenLastCalledWith([]));
  });

  it('draws none for a quest with no positions, nor with no quest', async () => {
    const { world } = await workspace({ quest: undefined });
    await waitFor(() => expect(world.setWorldLayer).toHaveBeenCalled());
    expect(world.setMarkers).not.toHaveBeenCalled();
  });

  it('a scene step dragged in the view is moved in the quest, as one step', async () => {
    const { api, world, onQuestField } = await workspace();
    await act(async () => world.options.onMarkerMove('scene:s1:0:at', { x: 35, y: 45, z: 7 }));
    await waitFor(() => expect(onQuestField).toHaveBeenCalledTimes(1));
    const [field, value] = onQuestField.mock.lastCall!;
    expect(field).toBe(SCRIPTS_FIELD);
    expect(readScenes({ [SCRIPTS_FIELD]: value })[0]!.steps[0]).toMatchObject({ at: { x: 35, y: 45, z: 7, o: 1 } });
    expect(api.historyBegin).toHaveBeenCalledTimes(1);
    expect(api.historyBegin).toHaveBeenCalledWith('Moved Walk · step 1', { map: 0, x: 35, y: 45, z: 7 });
  });

  it('a fight’s summon point dragged in the view is moved on the project’s NPC', async () => {
    const { world, project, onQuestField } = await workspace();
    await act(async () => world.options.onMarkerMove('fight:12000005:r1:0', { x: 52, y: 62, z: 6 }));
    await waitFor(() => expect(project.setEntities).toHaveBeenCalledTimes(1));
    expect(project.setEntities.mock.lastCall[0].npcs[0].fight.reactions[0].steps[0].at).toEqual({ x: 52, y: 62, z: 6, o: 1 });
    expect(onQuestField).not.toHaveBeenCalled();
  });

  it('a marker clicked in the view shows its card, and Deselect lets it go', async () => {
    const { world } = await workspace();
    await waitFor(() => expect(world.setMarkers).toHaveBeenCalled());
    act(() => world.options.onMarkerSelect('scene:s1:0:at'));
    const card = screen.getByRole('region', { name: 'Selected quest position' });
    expect(within(card).getByText('Walk · step 1')).toBeTruthy();
    expect(within(card).getByText('Scene step')).toBeTruthy();
    expect(within(card).getByText('X 31.00 · Y 41.00 · Z 5.00')).toBeTruthy();
    await userEvent.click(within(card).getByRole('button', { name: 'Deselect' }));
    expect(world.selectMarker).toHaveBeenLastCalledWith(null);
    expect(screen.queryByRole('region', { name: 'Selected quest position' })).toBeNull();
  });

  it('Show in World on a position takes the camera to its marker and selects it, until Done', async () => {
    const { world, onRequestEnd } = await workspace({ request: { kind: 'marker', id: 'scene:s1:0:at', nonce: 1 } });
    await waitFor(() => expect(world.selectMarker).toHaveBeenCalledWith('scene:s1:0:at'));
    // The world is built looking at it
    expect(world.options.start).toEqual({ x: 31, y: 41, z: 5 });
    expect(await screen.findByRole('region', { name: 'Selected quest position' })).toBeTruthy();
    expect(screen.getByText(/Showing Walk · step 1/)).toBeTruthy();
    expect(onRequestEnd).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onRequestEnd).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Showing Walk/)).toBeNull();
  });

  it('asked for once the world is up, the camera flies there', async () => {
    const { world, rerender } = await workspace();
    await waitFor(() => expect(world.setMarkers).toHaveBeenCalled());
    rerender({ request: { kind: 'marker', id: 'fight:12000005:r1:0', nonce: 1 } });
    await waitFor(() => expect(world.lookAt).toHaveBeenCalledWith(50, 60, 5));
    expect(world.selectMarker).toHaveBeenCalledWith('fight:12000005:r1:0');
  });

  it('says so, and ends at once, when the position is not the open quest’s or is on a map the view does not draw', async () => {
    const { onRequestEnd, rerender } = await workspace({ request: { kind: 'marker', id: 'scene:gone:0:at', nonce: 1 } });
    expect(await screen.findByText('That position is not in the open quest.')).toBeTruthy();
    expect(onRequestEnd).toHaveBeenCalledTimes(1);
    rerender({ request: { kind: 'marker', id: 'area:s2', nonce: 2 } });
    expect(await screen.findByText('Cave · area is on a map the 3D view does not draw.')).toBeTruthy();
    expect(onRequestEnd).toHaveBeenCalledTimes(2);
  });

  it('a shown position whose quest closes ends what was asked', async () => {
    const { onRequestEnd, rerender } = await workspace({ request: { kind: 'marker', id: 'scene:s1:0:at', nonce: 1 } });
    await screen.findByText(/Showing Walk/);
    rerender({ quest: undefined });
    await waitFor(() => expect(onRequestEnd).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/Showing Walk/)).toBeNull();
  });
});

describe('a modal over the World asking to show a quest position', () => {
  it('steps aside, as the position is there to be dragged, and comes back once done', () => {
    const outer = vi.fn();
    const { result } = renderHook(() => useAsideForWorld(), { wrapper: ({ children }) => <PlaceInWorldProvider value={outer}>{children}</PlaceInWorldProvider> });
    act(() => result.current[1]!({ kind: 'marker', id: 'scene:s1:0:at' }));
    expect(result.current[0]).toBe(true);
    act(() => outer.mock.lastCall![1]());
    expect(result.current[0]).toBe(false);
  });
});
