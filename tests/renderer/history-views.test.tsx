// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NamesProvider } from '../../src/renderer/state/names';
import { createAppStore } from '../../src/renderer/state/app-store';
import { HistoryProvider } from '../../src/renderer/state/history-context';
import { makeMockApi, okv } from './mock-api';

const worlds = vi.hoisted(() => [] as any[]);
vi.mock('../../src/renderer/world3d/world3d', () => ({
  createWorld3D: (options: any) => {
    const world = { options, dispose: vi.fn(), cancelPath: vi.fn(), cancelDrag: vi.fn(), lookAt: vi.fn(), setDocks: vi.fn(), setDocksEnabled: vi.fn(), frameOfSpawn: vi.fn(() => null), setSpawnVisibility: vi.fn(), setOwnSpawns: vi.fn(), select: vi.fn(),
      setWorldLayer: vi.fn(), setMode: vi.fn(), setScenery: vi.fn(), setTool: vi.fn(), setFalloff: vi.fn(),
      target: () => ({ x: 0, y: 0, z: 0 }), spawnStatus: () => ({ capped: { creatures: false, objects: false }, error: null }) };
    worlds.push(world);
    return world;
  },
}));
import { World3DView } from '../../src/renderer/world3d/World3DView';
import { ProjectChanges } from '../../src/renderer/world3d/ProjectChanges';

afterEach(() => { worlds.length = 0; vi.unstubAllGlobals(); });
const EMPTY = { spawns: [], routes: [], added: [], movements: [] };
const moved = { ...EMPTY, spawns: [{ kind: 'creature', guid: 80330, entry: 1423, name: 'Guard', map: 0, original: { x: 0, y: 0, z: 0, orientation: 0, rotation: null }, current: { x: 1, y: 2, z: 3, orientation: 0, rotation: null } }] };

describe('views after an undo', () => {
  it('the 3D view draws the layer an undo left, and cancels a drag first', async () => {
    vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1]), { status: 200 }));
    const api = makeMockApi({ worldLayer: vi.fn(async () => okv(EMPTY)) });
    const store = createAppStore(api);
    render(<NamesProvider api={api}><HistoryProvider store={store}><World3DView map={0} start={{ x: 0, y: 0, z: 0 }} hasClient /></HistoryProvider></NamesProvider>);
    await waitFor(() => expect(worlds).toHaveLength(1));
    act(() => store.setState({ worldLayer: { layer: moved as any, seq: 1 } }));
    await waitFor(() => expect(worlds[0].setWorldLayer).toHaveBeenLastCalledWith(moved));
    expect(worlds[0].cancelDrag).toHaveBeenCalled();
  });

  it('Project changes reloads its list when the layer changes while it is open', async () => {
    const worldChanges = vi.fn(async () => okv([]));
    const api = makeMockApi({ worldChanges });
    const { rerender } = render(<ProjectChanges api={api} onLayer={vi.fn()} onClose={vi.fn()} layerSeq={0} />);
    await waitFor(() => expect(worldChanges).toHaveBeenCalledTimes(1));
    rerender(<ProjectChanges api={api} onLayer={vi.fn()} onClose={vi.fn()} layerSeq={1} />);
    await waitFor(() => expect(worldChanges).toHaveBeenCalledTimes(2));
  });
});
