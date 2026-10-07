// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GroupCard, groupDrawingOf } from '../../src/renderer/world3d/GroupCard';
import { NamesProvider } from '../../src/renderer/state/names';
import { HistoryProvider } from '../../src/renderer/state/history-context';
import { createAppStore } from '../../src/renderer/state/app-store';
import { makeMockApi, okv } from './mock-api';

const worlds = vi.hoisted(() => [] as any[]);
vi.mock('../../src/renderer/world3d/world3d', () => ({
  createWorld3D: (options: any) => {
    const canvas = document.createElement('canvas');
    options.container.appendChild(canvas);
    const world = { options, canvas, dispose: vi.fn(), lookAt: vi.fn(), setSpawnVisibility: vi.fn(), setOwnSpawns: vi.fn(), select: vi.fn(), selectSpawns: vi.fn(),
      setWorldLayer: vi.fn(), setMode: vi.fn(), setPlacing: vi.fn(), cancelDrag: vi.fn(), setMarked: vi.fn(), setGroupView: vi.fn(), setGroupSpawns: vi.fn(),
      setScenery: vi.fn(), setTool: vi.fn(), setFalloff: vi.fn(), setPendingMovement: vi.fn(), spawnMovement: vi.fn(() => null), startPath: vi.fn(), finishPath: vi.fn(), cancelPath: vi.fn(), undoPoint: vi.fn(),
      selectedSpawns: vi.fn(() => []), groundAt: vi.fn(() => null), lastPointer: vi.fn(() => null), spawnOf: vi.fn(() => ({})), routeOf: vi.fn(() => null),
      camera: () => ({ position: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }),
      target: () => ({ x: 0, y: 0, z: 0 }), spawnStatus: () => ({ capped: { creatures: false, objects: false }, error: null }) };
    worlds.push(world);
    return world;
  },
}));

import { World3DView } from '../../src/renderer/world3d/World3DView';

afterEach(() => { worlds.length = 0; vi.unstubAllGlobals(); });

const view = { id: 32492, name: 'Path 1', map: 571, maxActive: 1, event: null, members: [
  { key: 'npc:39203', type: 'spawn' as const, name: 'Time-Lost Proto-Drake', chance: 10, at: { x: 10, y: 0, z: 0 } },
  { key: 'npc:39207', type: 'spawn' as const, name: 'Vyragosa', chance: 0, at: { x: 12, y: 0, z: 0 } },
] };

describe('the group card', () => {
  it('names the group, how many are up at once, and each member\'s chance', async () => {
    const onEdit = vi.fn();
    render(<GroupCard view={view} onEdit={onEdit} onClose={vi.fn()} />);
    const card = screen.getByRole('region', { name: 'Spawn group' });
    expect(within(card).getByText('Path 1')).toBeTruthy();
    expect(within(card).getByText('1 of 2 at a time')).toBeTruthy();
    expect(within(card).getByText('Time-Lost Proto-Drake · 10%')).toBeTruthy();
    expect(within(card).getByText('Vyragosa · 90% (equal share)')).toBeTruthy();
    await userEvent.click(within(card).getByRole('button', { name: 'Edit group…' }));
    expect(onEdit).toHaveBeenCalled();
  });
});

describe('the group card event line', () => {
  it('says which event the group follows', () => {
    const { unmount } = render(<GroupCard view={{ ...view, event: { id: 12, name: 'Darkmoon Faire', during: true } }} onClose={vi.fn()} />);
    expect(screen.getByText('Only during Darkmoon Faire')).toBeTruthy();
    unmount();
    render(<GroupCard view={{ ...view, event: { id: 12, name: 'Darkmoon Faire', during: false } }} onClose={vi.fn()} />);
    expect(screen.getByText('Except during Darkmoon Faire')).toBeTruthy();
  });
});

describe('the group as the view draws it', () => {
  it('rings the spawn members and draws lines from their centre to each', () => {
    const mixed = { ...view, members: [...view.members, { key: 'object:5', type: 'spawn' as const, name: 'Chest', chance: 0, at: { x: 14, y: 3, z: 0 } }, { key: 'group:7', type: 'group' as const, name: 'Inner', chance: 0, at: null }] };
    expect(groupDrawingOf(mixed)).toEqual({
      centre: { x: 12, y: 1, z: 0 },
      members: [{ kind: 'creature', guid: 39203 }, { kind: 'creature', guid: 39207 }, { kind: 'object', guid: 5 }],
      points: [{ x: 10, y: 0, z: 0 }, { x: 12, y: 0, z: 0 }, { x: 14, y: 3, z: 0 }],
    });
  });
});

describe("the spawns under the layer's top-level groups", () => {
  it('are asked for each group with an event, one whose database event was cleared, and a deleted one that had an event', async () => {
    vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1]), { status: 200 }));
    const existing = (event: Record<string, string> | null) => ({ kind: 'existing', original: { template: {}, members: [], event } });
    const group = (id: number, extra: Record<string, unknown>) => ({ id, name: 'g', map: 571, maxActive: 1, event: null, origin: { kind: 'new' }, members: [], ...extra });
    const groups = [
      group(9, { event: { id: 4, during: true } }),
      group(19, { origin: existing({ eventEntry: '12', pool_entry: '19' }) }),
      group(30, { origin: existing({ eventEntry: '12', pool_entry: '30' }), removed: true }),
      group(40, { origin: existing(null) }),
      group(41, { origin: existing({ eventEntry: '12', pool_entry: '41' }), event: { id: 12, during: true }, members: [{ type: 'group', id: 42, chance: 0 }] }),
      group(42, { origin: existing({ eventEntry: '5', pool_entry: '42' }) }),
    ];
    const api = makeMockApi({
      worldLayer: vi.fn(async () => okv({ spawns: [], routes: [], added: [], groups })),
      mapFloors: vi.fn(async () => okv({ reason: 'none' })),
      worldGroupSpawns: vi.fn(async (id: number) => okv([{ kind: 'npc', guid: id * 100 }])),
    });
    render(<NamesProvider api={api}><HistoryProvider store={createAppStore(api)}><World3DView map={571} start={{ x: 0, y: 0, z: 0 }} hasClient /></HistoryProvider></NamesProvider>);
    await waitFor(() => expect(worlds).toHaveLength(1));
    await waitFor(() => expect(worlds[0].setGroupSpawns).toHaveBeenCalled());
    expect(vi.mocked(api.worldGroupSpawns).mock.calls.map((c: any[]) => c[0]).sort((a: number, b: number) => a - b)).toEqual([9, 19, 30, 41]);
    expect([...worlds[0].setGroupSpawns.mock.lastCall[0].keys()].sort((a: number, b: number) => a - b)).toEqual([9, 19, 30, 41]);
  });
});

describe('selecting a pooled spawn in the 3D view', () => {
  const drake = { kind: 'creature' as const, guid: 39203, entry: 32491, name: 'Time-Lost Proto-Drake', own: false, added: false, pathId: 0, wander: 0, map: 571, group: 32492, respawnSecs: 300, placement: { x: 10, y: 0, z: 0, orientation: 0, rotation: null } };
  const picked = { kind: 'creature' as const, guid: 39203, entry: 32491, name: 'Time-Lost Proto-Drake', own: false, added: false, pathId: 0, event: null, position: { x: 10, y: 0, z: 0 } };

  it('shows its group card and rings, and takes both away when the card closes or the selection goes', async () => {
    vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1]), { status: 200 }));
    const api = makeMockApi({
      worldLayer: vi.fn(async () => okv({ spawns: [], routes: [], added: [] })),
      mapFloors: vi.fn(async () => okv({ reason: 'none' })),
      worldGroupView: vi.fn(async () => okv(view)),
    });
    render(<NamesProvider api={api}><HistoryProvider store={createAppStore(api)}><World3DView map={571} start={{ x: 0, y: 0, z: 0 }} hasClient /></HistoryProvider></NamesProvider>);
    await waitFor(() => expect(worlds).toHaveLength(1));
    const world = worlds[0];
    world.selectedSpawns.mockReturnValue([drake]);
    act(() => {
      world.options.onSelection({ creatures: 1, objects: 0, points: 0, routes: 0 });
      world.options.onSelect(picked);
    });
    const card = await screen.findByRole('region', { name: 'Spawn group' });
    expect(api.worldGroupView).toHaveBeenCalledWith(32492);
    expect(world.setGroupView).toHaveBeenLastCalledWith({
      centre: { x: 11, y: 0, z: 0 },
      members: [{ kind: 'creature', guid: 39203 }, { kind: 'creature', guid: 39207 }],
      points: [{ x: 10, y: 0, z: 0 }, { x: 12, y: 0, z: 0 }],
    });
    await userEvent.click(within(card).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('region', { name: 'Spawn group' })).toBeNull();
    expect(world.setGroupView).toHaveBeenLastCalledWith(null);

    // Selected again it shows again; selecting nothing takes it away
    act(() => world.options.onSelect(null));
    act(() => world.options.onSelect(picked));
    await screen.findByRole('region', { name: 'Spawn group' });
    world.selectedSpawns.mockReturnValue([]);
    act(() => world.options.onSelect(null));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Spawn group' })).toBeNull());
    expect(world.setGroupView).toHaveBeenLastCalledWith(null);
  });

  it('a spawn in no group shows no card', async () => {
    vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1]), { status: 200 }));
    const api = makeMockApi({ worldLayer: vi.fn(async () => okv({ spawns: [], routes: [], added: [] })), mapFloors: vi.fn(async () => okv({ reason: 'none' })) });
    render(<NamesProvider api={api}><HistoryProvider store={createAppStore(api)}><World3DView map={571} start={{ x: 0, y: 0, z: 0 }} hasClient /></HistoryProvider></NamesProvider>);
    await waitFor(() => expect(worlds).toHaveLength(1));
    worlds[0].selectedSpawns.mockReturnValue([{ ...drake, group: null }]);
    act(() => worlds[0].options.onSelect(picked));
    await new Promise((r) => setTimeout(r, 20));
    expect(api.worldGroupView).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'Spawn group' })).toBeNull();
  });
});
