// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';

type Fake = { setActive: ReturnType<typeof vi.fn>; at: { x: number; y: number; z: number }; area: (name: string) => void };
const created = vi.hoisted(() => [] as Fake[]);

vi.mock('../../src/renderer/world3d/world3d', () => ({
  createWorld3D: (options: { onArea?: (name: string) => void }) => {
    const world = {
      at: { x: 1, y: 2, z: 3 }, setActive: vi.fn(), dispose: vi.fn(), lookAt: vi.fn(), setSpawnVisibility: vi.fn(),
      spawnStatus: () => ({ capped: { creatures: false, objects: false }, error: null, loading: 0 }),
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
});
