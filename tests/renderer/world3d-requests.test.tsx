// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NamesProvider } from '../../src/renderer/state/names';
import { ProjectEntitiesProvider } from '../../src/renderer/state/project-entities';
import { HistoryProvider } from '../../src/renderer/state/history-context';
import { createAppStore } from '../../src/renderer/state/app-store';
import { EMPTY_ENTITIES, newNpc, newSpawn } from '../../src/core/entities/model';
import { makeMockApi, okv } from './mock-api';

const worlds = vi.hoisted(() => [] as any[]);
vi.mock('../../src/renderer/world3d/world3d', () => ({
  createWorld3D: (options: any) => {
    const world = { options, dispose: vi.fn(), cancelPath: vi.fn(), lookAt: vi.fn(), setDocks: vi.fn(), setDocksEnabled: vi.fn(), setMovementPlaying: vi.fn(), resetMovement: vi.fn(), frameOfSpawn: vi.fn(() => null), setSpawnVisibility: vi.fn(), setOwnSpawns: vi.fn(), select: vi.fn(),
      setWorldLayer: vi.fn(), setMode: vi.fn(), setPlacing: vi.fn(), cancelDrag: vi.fn(), setScenery: vi.fn(), setTool: vi.fn(), setFalloff: vi.fn(),
      startPath: vi.fn(), finishPath: vi.fn(), spawnOf: vi.fn(() => null), selectedSpawns: vi.fn(() => []),
      camera: () => ({ position: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }), target: () => ({ x: 0, y: 0, z: 0 }),
      spawnStatus: () => ({ capped: { creatures: false, objects: false }, error: null }) };
    worlds.push(world);
    return world;
  },
}));

import { World3DView } from '../../src/renderer/world3d/World3DView';
import { WorldWorkspace } from '../../src/renderer/world3d/WorldWorkspace';

const EMPTY = { spawns: [], routes: [], added: [] };
const placement = { x: 30, y: 40, z: 5, orientation: 0, rotation: null };
const helaAt = (pathId: number) => ({ kind: 'creature' as const, guid: 900, entry: 12000005, name: 'Hela', own: true, added: false, pathId, wander: 0, map: 0, respawnSecs: 300, group: null, placement });

afterEach(() => {
  worlds.length = 0;
  vi.unstubAllGlobals();
  localStorage.clear();
});

async function view(props: Partial<React.ComponentProps<typeof World3DView>>) {
  vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1]), { status: 200 }));
  const api = makeMockApi({ worldLayer: vi.fn(async () => okv(EMPTY)), patrolPathId: vi.fn(async () => okv(4242)) });
  const onRequestEnd = vi.fn();
  const ui = (more: Partial<React.ComponentProps<typeof World3DView>>) => (
    <NamesProvider api={api}><HistoryProvider store={createAppStore(api)}>
      <World3DView map={0} start={{ x: 0, y: 0, z: 0 }} hasClient onRequestEnd={onRequestEnd} {...props} {...more} />
    </HistoryProvider></NamesProvider>
  );
  const { rerender } = render(ui({}));
  await waitFor(() => expect(worlds).toHaveLength(1));
  return { api, world: worlds[0], onRequestEnd, rerender: (more: Partial<React.ComponentProps<typeof World3DView>>) => rerender(ui(more)) };
}

describe('the 3D view does what an editor asked', () => {
  it('places the NPC asked for, and says so once placing stops', async () => {
    const { world, onRequestEnd } = await view({ placeRequest: { kind: 'creature', entry: 12000005, name: 'Hela', nonce: 1 } });
    await waitFor(() => expect(world.setPlacing).toHaveBeenLastCalledWith({ kind: 'creature', entry: 12000005 }));
    expect(screen.getByText(/Placing Hela \(#12000005\)/)).toBeTruthy();
    expect(onRequestEnd).not.toHaveBeenCalled();
    act(() => world.options.onPlaceEnd());
    await waitFor(() => expect(onRequestEnd).toHaveBeenCalledTimes(1));
    expect(world.setPlacing).toHaveBeenLastCalledWith(null);
  });

  it('a placing stopped with Done ends what was asked too', async () => {
    const { onRequestEnd } = await view({ placeRequest: { kind: 'object', entry: 9100001, name: 'Crate', nonce: 1 } });
    await userEvent.click(await screen.findByRole('button', { name: 'Done' }));
    expect(onRequestEnd).toHaveBeenCalledTimes(1);
  });

  it('starts a new path for an NPC with none once it is drawn, and ends when the path is finished', async () => {
    const { api, world, onRequestEnd } = await view({ patrolRequest: { guid: 900, name: 'Hela', nonce: 1 } });
    expect(screen.getByText(/Finding Hela/)).toBeTruthy();
    world.spawnOf.mockReturnValue(helaAt(0));
    await waitFor(() => expect(world.startPath).toHaveBeenCalledWith(900, 4242, placement));
    expect(api.patrolPathId).toHaveBeenCalledWith(900);
    expect(world.spawnOf).toHaveBeenCalledWith('creature', 900);
    expect(await screen.findByText(/Drawing Hela’s patrol/)).toBeTruthy();
    act(() => world.options.onDrawing({ guid: 900, points: 3 }));
    expect(onRequestEnd).not.toHaveBeenCalled();
    act(() => world.options.onDrawing(null));
    expect(onRequestEnd).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Hela’s patrol/)).toBeNull();
  });

  // A busy place's NPCs can take longer than the look's time limit to load; the NPC is in one of them
  it('keeps looking for the NPC while the world is still loading its NPCs, then gives up once it is not', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let loading = 3;
      const { world, onRequestEnd } = await view({ patrolRequest: { guid: 900, name: 'Hela', nonce: 1 } });
      world.spawnStatus = () => ({ capped: { creatures: false, objects: false }, error: null, loading, events: [] });
      act(() => vi.advanceTimersByTime(60_000));
      expect(onRequestEnd).not.toHaveBeenCalled();
      expect(screen.queryByText(/could not be found/)).toBeNull();
      loading = 0;
      act(() => vi.advanceTimersByTime(60_000));
      expect(onRequestEnd).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Hela could not be found in the view.')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves an NPC that already patrols to have its route edited, until Done', async () => {
    const { world, onRequestEnd } = await view({ patrolRequest: { guid: 900, name: 'Hela', nonce: 1 } });
    world.spawnOf.mockReturnValue(helaAt(80));
    expect(await screen.findByText(/drag its points/)).toBeTruthy();
    expect(world.startPath).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onRequestEnd).toHaveBeenCalledTimes(1);
  });

  it('Done while drawing finishes the path, and ends once', async () => {
    const { world, onRequestEnd } = await view({ patrolRequest: { guid: 900, name: 'Hela', nonce: 1 } });
    world.spawnOf.mockReturnValue(helaAt(0));
    world.finishPath.mockImplementation(() => world.options.onDrawing(null));
    await waitFor(() => expect(world.startPath).toHaveBeenCalled());
    await userEvent.click(await screen.findByRole('button', { name: 'Done' }));
    expect(world.finishPath).toHaveBeenCalled();
    expect(onRequestEnd).toHaveBeenCalledTimes(1);
  });
});

describe('the World workspace takes an editor’s request', () => {
  const hela = { ...newNpc(12000005), name: 'Hela', spawns: [{ ...newSpawn(900), map: 0, x: 30, y: 40, z: 5 }] };
  async function workspace(request: React.ComponentProps<typeof WorldWorkspace>['request']) {
    vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1]), { status: 200 }));
    localStorage.setItem('acqc.welcome.seen', JSON.stringify(['k']));
    const api = makeMockApi({ worldLayer: vi.fn(async () => okv(EMPTY)), patrolPathId: vi.fn(async () => okv(4242)) });
    const project = { entities: { ...EMPTY_ENTITIES, npcs: [hela] }, setEntities: vi.fn(), quests: [], layer: EMPTY, setLayer: vi.fn(), tracked: [], create: vi.fn(), remove: vi.fn(), adopt: vi.fn(), ensure: vi.fn(async () => null) } as any;
    const onRequestEnd = vi.fn();
    render(<NamesProvider api={api}><ProjectEntitiesProvider value={project}><HistoryProvider store={createAppStore(api)}>
      <WorldWorkspace hasClient projectKey="k" projectName="North" onOpenSettings={vi.fn()} onShowQuests={vi.fn()} onStartQuest={vi.fn()} request={request} onRequestEnd={onRequestEnd} />
    </HistoryProvider></ProjectEntitiesProvider></NamesProvider>);
    await waitFor(() => expect(worlds.length).toBeGreaterThan(0));
    return { world: worlds.at(-1), onRequestEnd };
  }

  // The editor that asked is stepped aside: the World says what it shows, and Done brings the editor back
  it('shows the exact spawn asked for, by its guid, until Done', async () => {
    const { world, onRequestEnd } = await workspace({ kind: 'spawn', spawn: 'creature', entry: 12000005, guid: 900, nonce: 1 });
    await waitFor(() => expect(world.select).toHaveBeenCalledWith({ kind: 'creature', guid: 900 }));
    expect(world.lookAt).toHaveBeenCalledWith(30, 40, 6, true);
    expect(await screen.findByText(/Showing Hela\./)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onRequestEnd).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Showing Hela/)).toBeNull();
  });

  it('says so, and ends at once, when the spawn to show is not there', async () => {
    const { onRequestEnd } = await workspace({ kind: 'spawn', spawn: 'creature', entry: 12000005, guid: 901, nonce: 1 });
    expect(await screen.findByText('That spawn is no longer in the project.')).toBeTruthy();
    expect(onRequestEnd).toHaveBeenCalledTimes(1);
  });

  it('shows a quest or one of its NPCs asked for from an editor, until Done', async () => {
    const { onRequestEnd } = await workspace({ kind: 'show', target: { questId: 60001, kind: 'creature', entry: 12000005 }, nonce: 1 });
    expect(await screen.findByText(/Showing Hela\./)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onRequestEnd).toHaveBeenCalledTimes(1);
  });

  it('goes to the spawn whose patrol is asked for and starts its path', async () => {
    const { world, onRequestEnd } = await workspace({ kind: 'patrol', entry: 12000005, guid: 900, nonce: 1 });
    await waitFor(() => expect(world.select).toHaveBeenCalledWith({ kind: 'creature', guid: 900 }));
    world.spawnOf.mockReturnValue(helaAt(0));
    await waitFor(() => expect(world.startPath).toHaveBeenCalledWith(900, 4242, placement));
    act(() => world.options.onDrawing(null));
    expect(onRequestEnd).toHaveBeenCalledTimes(1);
  });

  it('places the NPC asked for, by its name', async () => {
    const { world, onRequestEnd } = await workspace({ kind: 'creature', entry: 12000005, nonce: 1 });
    await waitFor(() => expect(world.setPlacing).toHaveBeenLastCalledWith({ kind: 'creature', entry: 12000005 }));
    expect(screen.getByText(/Placing Hela/)).toBeTruthy();
    act(() => world.options.onPlaceEnd());
    await waitFor(() => expect(onRequestEnd).toHaveBeenCalledTimes(1));
  });

  it('says so, and ends at once, when the spawn asked for is not there', async () => {
    const { onRequestEnd } = await workspace({ kind: 'patrol', entry: 12000005, guid: 901, nonce: 1 });
    expect(await screen.findByText('That spawn is no longer in the project.')).toBeTruthy();
    expect(onRequestEnd).toHaveBeenCalledTimes(1);
  });
});
