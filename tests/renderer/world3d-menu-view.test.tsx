// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NamesProvider } from '../../src/renderer/state/names';
import { makeMockApi, okv } from './mock-api';
import { clearClipboard } from '../../src/renderer/world3d/clipboard';

const worlds = vi.hoisted(() => [] as any[]);
vi.mock('../../src/renderer/world3d/world3d', () => ({
  createWorld3D: (options: any) => {
    const canvas = document.createElement('canvas');
    canvas.tabIndex = 0;
    options.container.appendChild(canvas);
    const world = { options, canvas, dispose: vi.fn(), lookAt: vi.fn(), setSpawnVisibility: vi.fn(), setOwnSpawns: vi.fn(), select: vi.fn(), selectSpawns: vi.fn(),
      setWorldLayer: vi.fn(), setMode: vi.fn(), setPlacing: vi.fn(), undo: vi.fn(), redo: vi.fn(), record: vi.fn(), setMarked: vi.fn(),
      setActive: vi.fn(), setScenery: vi.fn(), setTool: vi.fn(), setFalloff: vi.fn(), setPendingMovement: vi.fn(), spawnMovement: vi.fn(() => ({ type: 'idle', wander: 0, pathId: null })),
      startPath: vi.fn(), finishPath: vi.fn(), cancelPath: vi.fn(), undoPoint: vi.fn(), selectedSpawns: vi.fn(() => []), groundAt: vi.fn(() => ({ x: 50, y: 60, z: 7 })), lastPointer: vi.fn(() => null),
      hasSpawn: vi.fn(() => true), routeOf: vi.fn(() => null),
      camera: () => ({ position: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }),
      target: () => ({ x: 0, y: 0, z: 0 }), spawnStatus: () => ({ capped: { creatures: false, objects: false }, error: null }) };
    worlds.push(world);
    return world;
  },
}));

import { World3DView } from '../../src/renderer/world3d/World3DView';

const EMPTY = { spawns: [], routes: [], added: [] };
const look = { displayId: 1, scale: 1, equipment: [0, 0, 0] as [number, number, number], preset: null };
const guard = { kind: 'creature' as const, guid: 80330, entry: 1423, name: 'Guard', own: false, added: false, pathId: 0, wander: 0, map: 0, placement: { x: 10, y: 0, z: 5, orientation: 1, rotation: null } };
const at = { x: 1, y: 2, z: 3 };

beforeEach(() => clearClipboard());
afterEach(() => { worlds.length = 0; vi.unstubAllGlobals(); });

async function view(overrides: Record<string, unknown> = {}) {
  vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1]), { status: 200 }));
  const api = makeMockApi({
    worldLayer: vi.fn(async () => okv(EMPTY)),
    mapFloors: vi.fn(async () => okv({ reason: 'none' })),
    worldAddSpawn: vi.fn(async (kind: string, entry: number, map: number, placement: any, guid?: number) => okv({ layer: { ...EMPTY, added: [{ kind, guid: guid ?? 90001, entry, name: 'Guard', map, placement, look }] }, guid: guid ?? 90001 })),
    worldSetMovement: vi.fn(async () => okv(EMPTY)),
    worldNewPathId: vi.fn(async () => okv(803300)),
    searchEntities: vi.fn(async () => okv([{ id: 1423, name: 'Guard' }])),
    ...overrides,
  });
  render(<NamesProvider api={api}><World3DView map={0} start={{ x: 0, y: 0, z: 0 }} hasClient /></NamesProvider>);
  await waitFor(() => expect(worlds).toHaveLength(1));
  return { api, world: worlds[0] };
}
const rightClick = (world: any, target: any) => act(() => world.options.onContextMenu(target, { x: 40, y: 40 }));

describe('the right-click menu in the 3D view', () => {
  it('opens at the click with what the target offers, and Esc closes it', async () => {
    const { world } = await view();
    rightClick(world, { ground: at, hit: null, selection: [] });
    expect(screen.getByRole('menu', { name: 'World actions' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Place NPC here…' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Place NPC here puts one down where it was right-clicked, selects it, and records it for undo', async () => {
    const { api, world } = await view();
    rightClick(world, { ground: at, hit: null, selection: [] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Place NPC here…' }));
    await userEvent.type(await screen.findByRole('searchbox', { name: 'Find by name or ID' }), 'Guard');
    await userEvent.click(await screen.findByRole('button', { name: /Guard/ }));
    await waitFor(() => expect(api.worldAddSpawn).toHaveBeenCalledWith('creature', 1423, 0, expect.objectContaining({ x: 1, y: 2, z: 3 })));
    expect(world.setPlacing).not.toHaveBeenCalledWith(expect.objectContaining({ entry: 1423 }));
    await waitFor(() => expect(world.record).toHaveBeenCalledWith(
      [expect.objectContaining({ kind: 'presence', present: false, spawn: expect.objectContaining({ guid: 90001 }) })],
      [expect.objectContaining({ kind: 'presence', present: true, spawn: expect.objectContaining({ guid: 90001 }) })]));
    expect(world.selectSpawns).toHaveBeenCalledWith([{ kind: 'creature', guid: 90001 }]);
  });

  it('copies the selection and pastes it where right-clicked, on the map being viewed, as one undo step', async () => {
    const { api, world } = await view();
    world.selectedSpawns.mockReturnValue([{ ...guard, map: 1 }, { ...guard, guid: 80331, placement: { ...guard.placement, x: 20 } }]);
    rightClick(world, { ground: at, hit: { type: 'spawn', spawn: guard }, selection: [guard, { ...guard, guid: 80331 }] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Copy 2' }));
    rightClick(world, { ground: { x: 100, y: 0, z: 0 }, hit: null, selection: [] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Paste here (2)' }));
    await waitFor(() => expect(api.worldAddSpawn).toHaveBeenCalledTimes(2));
    expect((api.worldAddSpawn as any).mock.calls.map((c: any[]) => [c[2], c[3].x])).toEqual([[0, 95], [0, 105]]);
    await waitFor(() => expect(world.record).toHaveBeenCalledTimes(1));
  });

  it('Ctrl+C and Ctrl+V on the view copy and paste under the cursor; in a text field they do nothing', async () => {
    const { api, world } = await view();
    world.selectedSpawns.mockReturnValue([guard]);
    const field = document.createElement('input');
    document.body.appendChild(field);
    field.focus();
    await userEvent.keyboard('{Control>}c{/Control}{Control>}v{/Control}');
    expect(api.worldAddSpawn).not.toHaveBeenCalled();
    world.canvas.focus();
    act(() => { world.options.onShortcut('KeyC'); });
    act(() => { world.options.onShortcut('KeyV'); });
    await waitFor(() => expect(api.worldAddSpawn).toHaveBeenCalledWith('creature', 1423, 0, expect.objectContaining({ x: 50, y: 60 })));
    field.remove();
  });

  it('Copy coordinates writes the GM command, and says when the clipboard refuses', async () => {
    const writeText = vi.fn(async (_text: string) => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const { world } = await view();
    rightClick(world, { ground: { x: 1.234, y: -5, z: 7.891 }, hit: null, selection: [] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Copy coordinates' }));
    expect(writeText).toHaveBeenCalledWith('.go xyz 1.23 -5.00 7.89 0');
    expect(await screen.findByText('Copied .go xyz to the clipboard')).toBeInTheDocument();
    writeText.mockRejectedValueOnce(new Error('Document is not focused.'));
    rightClick(world, { ground: at, hit: null, selection: [] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Copy coordinates' }));
    expect(await screen.findByText('Could not copy to the clipboard: Document is not focused.')).toBeInTheDocument();
  });

  it('Start path here asks for a new path id and starts drawing; the first point is sent as a new route', async () => {
    const { api, world } = await view({ worldSetRoute: vi.fn(async () => okv(EMPTY)) });
    rightClick(world, { ground: at, hit: null, selection: [guard] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Start path here' }));
    await waitFor(() => expect(world.startPath).toHaveBeenCalledWith(80330, 803300, at));
    act(() => world.options.onEdit({ kind: 'route', spawn: { kind: 'creature', guid: 80330, entry: 1423, own: false }, pathId: 803300, points: [{ x: 1, y: 2, z: 3 }] }));
    await waitFor(() => expect(api.worldSetRoute).toHaveBeenCalledWith(803300, [{ x: 1, y: 2, z: 3, rest: {} }], { isNew: true }));
  });

  it('Change wander distance previews, and Apply sends the movement and records it', async () => {
    const { api, world } = await view();
    rightClick(world, { ground: at, hit: { type: 'spawn', spawn: guard }, selection: [guard] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Change wander distance…' }));
    const field = screen.getByRole('spinbutton', { name: 'Yards' });
    await userEvent.clear(field);
    await userEvent.type(field, '8');
    expect(world.setPendingMovement).toHaveBeenLastCalledWith(80330, { type: 'wander', wander: 8, pathId: null });
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(api.worldSetMovement).toHaveBeenCalledWith(80330, { type: 'wander', wander: 8, pathId: null }));
    expect(world.record).toHaveBeenCalledWith(
      [{ kind: 'movement', spawn: { kind: 'creature', guid: 80330, entry: 1423, own: false }, to: { type: 'idle', wander: 0, pathId: null } }],
      [{ kind: 'movement', spawn: { kind: 'creature', guid: 80330, entry: 1423, own: false }, to: { type: 'wander', wander: 8, pathId: null } }]);
  });

  it('says so and does nothing when the right-clicked spawn has gone', async () => {
    const { api, world } = await view();
    world.hasSpawn.mockReturnValue(false);
    rightClick(world, { ground: at, hit: { type: 'spawn', spawn: guard }, selection: [guard] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Change wander distance…' }));
    expect(await screen.findByText('That spawn is no longer here')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Wander distance' })).toBeNull();
    expect(api.worldSetMovement).not.toHaveBeenCalled();
  });

  it('an undone placement takes the spawn back out of the world layer, and its redo keeps the guid', async () => {
    const { api, world } = await view({ worldRevert: vi.fn(async () => okv(EMPTY)) });
    const spawn = { kind: 'creature', guid: 90001, entry: 1423, own: false };
    const placement = { x: 1, y: 2, z: 3, orientation: 0, rotation: null };
    act(() => world.options.onEdit({ kind: 'presence', spawn, present: false, at: placement, map: 0 }));
    await waitFor(() => expect(api.worldRevert).toHaveBeenCalledWith({ kind: 'spawn', spawnKind: 'creature', guid: 90001 }));
    act(() => world.options.onEdit({ kind: 'presence', spawn, present: true, at: placement, map: 0 }));
    await waitFor(() => expect(api.worldAddSpawn).toHaveBeenCalledWith('creature', 1423, 0, placement, 90001));
  });

  it('counts movement changes on the World changes button', async () => {
    const movements = [{ guid: 80330, entry: 1423, name: 'Guard', map: 0, addonRow: false, original: { type: 'idle', wander: 0, pathId: null }, current: { type: 'wander', wander: 5, pathId: null } }];
    await view({ worldLayer: vi.fn(async () => okv({ ...EMPTY, movements })) });
    expect(await screen.findByRole('button', { name: 'World changes (1)' })).toBeEnabled();
  });

  it('does not paste or duplicate while a path is drawn', async () => {
    const { api, world } = await view();
    world.selectedSpawns.mockReturnValue([guard]);
    act(() => { world.options.onShortcut('KeyC'); });
    act(() => world.options.onDrawing({ guid: 80330, points: 2 }));
    act(() => { world.options.onShortcut('KeyV'); });
    act(() => { world.options.onShortcut('KeyD'); });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.worldAddSpawn).not.toHaveBeenCalled();
  });

  it('a map switch cancels the path being drawn, and the next world\u2019s menu is the usual one', async () => {
    vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1]), { status: 200 }));
    const api = makeMockApi({ worldLayer: vi.fn(async () => okv(EMPTY)) });
    const { rerender } = render(<NamesProvider api={api}><World3DView map={0} start={{ x: 0, y: 0, z: 0 }} hasClient /></NamesProvider>);
    await waitFor(() => expect(worlds).toHaveLength(1));
    act(() => worlds[0].options.onDrawing({ guid: 80330, points: 1 }));
    rerender(<NamesProvider api={api}><World3DView map={1} start={{ x: 0, y: 0, z: 0 }} hasClient /></NamesProvider>);
    await waitFor(() => expect(worlds).toHaveLength(2));
    expect(worlds[0].cancelPath).toHaveBeenCalled();
    rightClick(worlds[1], { ground: at, hit: null, selection: [] });
    expect(screen.getByRole('menuitem', { name: 'Place NPC here…' })).toBeInTheDocument();
  });

  it('Remove path on a quest\u2019s own NPC keeps its points in the undo step', async () => {
    const onOwnEdit = vi.fn();
    vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1]), { status: 200 }));
    const api = makeMockApi({ worldLayer: vi.fn(async () => okv(EMPTY)) });
    render(<NamesProvider api={api}><World3DView map={0} start={{ x: 0, y: 0, z: 0 }} hasClient onOwnEdit={onOwnEdit} /></NamesProvider>);
    await waitFor(() => expect(worlds).toHaveLength(1));
    const world = worlds[0];
    const own = { ...guard, guid: 900, entry: 12000001, own: true, pathId: 9000 };
    world.spawnMovement.mockReturnValue({ type: 'path', wander: 0, pathId: 9000 });
    world.routeOf.mockReturnValue({ pathId: 9000, points: [{ x: 1, y: 1, z: 1 }, { x: 2, y: 2, z: 2 }] });
    rightClick(world, { ground: at, hit: { type: 'spawn', spawn: own }, selection: [own] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove path' }));
    const ref = { kind: 'creature', guid: 900, entry: 12000001, own: true };
    await waitFor(() => expect(world.record).toHaveBeenCalledWith(
      [{ kind: 'route', spawn: ref, pathId: 9000, points: [{ x: 1, y: 1, z: 1 }, { x: 2, y: 2, z: 2 }] }, { kind: 'movement', spawn: ref, to: { type: 'path', wander: 0, pathId: 9000 } }],
      [{ kind: 'movement', spawn: ref, to: { type: 'idle', wander: 0, pathId: null } }]));
  });
});
