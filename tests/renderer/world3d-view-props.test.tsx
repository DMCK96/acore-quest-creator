// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

type Fake = { setActive: ReturnType<typeof vi.fn>; setScenery: ReturnType<typeof vi.fn>; setSpawnVisibility: ReturnType<typeof vi.fn>; at: { x: number; y: number; z: number }; area: (name: string) => void };
const created = vi.hoisted(() => [] as Fake[]);
const nearby = vi.hoisted(() => ({ list: [] as { id: number; name: string }[] }));

vi.mock('../../src/renderer/world3d/world3d', () => ({
  createWorld3D: (options: { onArea?: (name: string) => void }) => {
    const world = {
      at: { x: 1, y: 2, z: 3 }, setActive: vi.fn(), setScenery: vi.fn(), setTool: vi.fn(), setFalloff: vi.fn(), dispose: vi.fn(), lookAt: vi.fn(), setSpawnVisibility: vi.fn(),
      spawnStatus: () => ({ capped: { creatures: false, objects: false }, error: null, loading: 0, events: nearby.list }),
      target() { return world.at; }, area: (name: string) => options.onArea?.(name),
    };
    created.push(world as unknown as Fake);
    return world;
  },
}));

import { World3DView } from '../../src/renderer/world3d/World3DView';

const start = { x: 0, y: 0, z: 0 };
afterEach(() => {
  created.length = 0;
  nearby.list = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const clientHasEverything = () => vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1]), { status: 200 }));

describe('the 3D view in a workspace', () => {
  it('stops drawing while inactive and starts again when active', async () => {
    clientHasEverything();
    const { rerender } = render(<World3DView map={0} start={start} hasClient active={false} />);
    await waitFor(() => expect(created).toHaveLength(1));
    await waitFor(() => expect(created[0]!.setActive).toHaveBeenLastCalledWith(false));
    rerender(<World3DView map={0} start={start} hasClient active />);
    expect(created[0]!.setActive).toHaveBeenLastCalledWith(true);
  });

  it('tells the area name to the workspace, and can leave its own label out', async () => {
    clientHasEverything();
    const onArea = vi.fn();
    render(<World3DView map={0} start={start} hasClient showArea={false} onArea={onArea} />);
    await waitFor(() => expect(created).toHaveLength(1));
    act(() => created[0]!.area('Northshire Valley'));
    expect(onArea).toHaveBeenLastCalledWith('Northshire Valley');
    expect(screen.queryByText('Northshire Valley')).toBeNull();
  });

  it('shows its own area label by default', async () => {
    clientHasEverything();
    render(<World3DView map={0} start={start} hasClient />);
    await waitFor(() => expect(created).toHaveLength(1));
    act(() => created[0]!.area('Goldshire'));
    expect(screen.getByText('Goldshire')).toBeInTheDocument();
  });

  it('reports where the camera rests once it has moved more than a yard', async () => {
    clientHasEverything();
    const onPlaceChange = vi.fn();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<World3DView map={0} start={start} hasClient onPlaceChange={onPlaceChange} />);
    await waitFor(() => expect(created).toHaveLength(1));
    await act(async () => vi.advanceTimersByTime(2000));
    expect(onPlaceChange).toHaveBeenLastCalledWith({ x: 1, y: 2, z: 3 });
    const calls = onPlaceChange.mock.calls.length;
    created[0]!.at = { x: 1.5, y: 2, z: 3 };
    await act(async () => vi.advanceTimersByTime(2000));
    expect(onPlaceChange).toHaveBeenCalledTimes(calls);
    created[0]!.at = { x: 10, y: 2, z: 3 };
    await act(async () => vi.advanceTimersByTime(2000));
    expect(onPlaceChange).toHaveBeenLastCalledWith({ x: 10, y: 2, z: 3 });
  });

  it('draws its panels on the shared surface, with the orb while it loads', async () => {
    clientHasEverything();
    render(<World3DView map={0} start={start} hasClient />);
    await waitFor(() => expect(created).toHaveLength(1));
    const layers = screen.getByRole('group', { name: 'Layers' });
    expect(layers).toHaveClass('glass');
    expect(within(layers).getByText('Layers')).toHaveClass('section-label');
    expect(screen.getByRole('status').querySelector('.orb-mark--spinning')).not.toBeNull();
  });

  it('shows or hides buildings and trees from the layers, and remembers the choice', async () => {
    clientHasEverything();
    localStorage.removeItem('acqc.world3d.layers');
    const first = render(<World3DView map={0} start={start} hasClient />);
    await waitFor(() => expect(created).toHaveLength(1));
    const layers = screen.getByRole('group', { name: 'Layers' });
    const buildings = within(layers).getByRole('checkbox', { name: 'Buildings' });
    const trees = within(layers).getByRole('checkbox', { name: 'Trees & props' });
    expect(buildings).toBeChecked();
    expect(trees).toBeChecked();
    expect(created[0]!.setScenery).toHaveBeenLastCalledWith({ buildings: true, doodads: true });
    await userEvent.click(buildings);
    expect(created[0]!.setScenery).toHaveBeenLastCalledWith({ buildings: false, doodads: true });
    await userEvent.click(trees);
    expect(created[0]!.setScenery).toHaveBeenLastCalledWith({ buildings: false, doodads: false });
    first.unmount();
    // The next view opens with them hidden
    render(<World3DView map={0} start={start} hasClient />);
    await waitFor(() => expect(created).toHaveLength(2));
    expect(within(screen.getByRole('group', { name: 'Layers' })).getByRole('checkbox', { name: 'Buildings' })).not.toBeChecked();
    expect(created[1]!.setScenery).toHaveBeenLastCalledWith({ buildings: false, doodads: false });
    localStorage.removeItem('acqc.world3d.layers');
  });

  it('shows the world during one event at a time, from those with spawns nearby, with no event by default and all events last', async () => {
    clientHasEverything();
    localStorage.removeItem('acqc.world3d.layers');
    nearby.list = [{ id: 3, name: 'Darkmoon Faire' }, { id: 12, name: "Hallow's End" }];
    const first = render(<World3DView map={0} start={start} hasClient />);
    await waitFor(() => expect(created).toHaveLength(1));
    const event = within(screen.getByRole('group', { name: 'Layers' })).getByRole('combobox', { name: 'Event' });
    expect(event).toHaveDisplayValue('No event');
    expect(screen.queryByRole('checkbox', { name: 'Event spawns' })).toBeNull();
    expect(created[0]!.setSpawnVisibility).toHaveBeenLastCalledWith(expect.objectContaining({ events: 'none' }));
    // The events near the camera come in as the spawns do
    await waitFor(() => expect(within(event).getAllByRole('option').map((o) => o.textContent)).toEqual(['No event', 'Darkmoon Faire', "Hallow's End", 'All events']));
    await userEvent.selectOptions(event, "Hallow's End");
    expect(created[0]!.setSpawnVisibility).toHaveBeenLastCalledWith(expect.objectContaining({ events: 12 }));
    await userEvent.selectOptions(event, 'All events');
    expect(created[0]!.setSpawnVisibility).toHaveBeenLastCalledWith(expect.objectContaining({ events: 'all' }));
    await userEvent.selectOptions(event, "Hallow's End");
    first.unmount();
    // Remembered, and kept in the list while its spawns are out of range
    nearby.list = [];
    render(<World3DView map={0} start={start} hasClient />);
    await waitFor(() => expect(created).toHaveLength(2));
    const again = within(screen.getByRole('group', { name: 'Layers' })).getByRole('combobox', { name: 'Event' });
    expect(again).toHaveDisplayValue("Hallow's End");
    expect(created[1]!.setSpawnVisibility).toHaveBeenLastCalledWith(expect.objectContaining({ events: 12 }));
    localStorage.removeItem('acqc.world3d.layers');
  });

  it('reads an event choice saved before the dropdown: the old box checked is all events, unchecked no event', async () => {
    clientHasEverything();
    localStorage.setItem('acqc.world3d.layers', JSON.stringify({ events: true }));
    const first = render(<World3DView map={0} start={start} hasClient />);
    await waitFor(() => expect(created).toHaveLength(1));
    expect(screen.getByRole('combobox', { name: 'Event' })).toHaveDisplayValue('All events');
    first.unmount();
    localStorage.setItem('acqc.world3d.layers', JSON.stringify({ events: false }));
    render(<World3DView map={0} start={start} hasClient />);
    expect(screen.getByRole('combobox', { name: 'Event' })).toHaveDisplayValue('No event');
    localStorage.removeItem('acqc.world3d.layers');
  });
});
