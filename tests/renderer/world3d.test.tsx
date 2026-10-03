// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const created = vi.hoisted(() => [] as { directory: string; map: number; start?: unknown; dispose: ReturnType<typeof vi.fn>; lookAt: ReturnType<typeof vi.fn>; ready: () => void }[]);
const failing = vi.hoisted(() => ({ on: false }));
const loadingAreas = vi.hoisted(() => ({ n: 0 }));

vi.mock('../../src/renderer/world3d/world3d', () => ({
  createWorld3D: (options: { directory: string; map: number; start: unknown; onReady?: () => void }) => {
    if (failing.on) throw new Error('WebGL is not available');
    const world = {
      directory: options.directory, map: options.map, start: options.start, dispose: vi.fn(), lookAt: vi.fn(), ready: () => options.onReady?.(),
      setSpawnVisibility: vi.fn(), spawnStatus: () => ({ capped: { creatures: false, objects: false }, error: null, loading: loadingAreas.n }),
    };
    created.push(world);
    return world;
  },
}));

import { World3DScreen } from '../../src/renderer/world3d/World3DScreen';
import teleports from '../../src/core/map/teleports.json';

afterEach(() => {
  created.length = 0;
  failing.on = false;
  loadingAreas.n = 0;
  vi.unstubAllGlobals();
});

const clientHasEverything = () => vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1]), { status: 200 }));

describe('3D view screen', () => {
  it('builds a world for the map, and replaces it (disposing the old one) when another continent is chosen', async () => {
    clientHasEverything();
    render(<World3DScreen hasClient onClose={() => {}} />);
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({ directory: 'azeroth', map: 0 });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Map' }), '1');
    await waitFor(() => expect(created).toHaveLength(2));
    expect(created[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(created[1]).toMatchObject({ directory: 'kalimdor', map: 1 });
    expect(screen.getByRole('dialog', { name: '3D view' })).toBeInTheDocument();
  });

  it('moves the camera of the world it has when Go is pressed, instead of building another', async () => {
    clientHasEverything();
    render(<World3DScreen hasClient onClose={() => {}} />);
    await waitFor(() => expect(created).toHaveLength(1));
    const x = screen.getByLabelText('X');
    await userEvent.clear(x);
    await userEvent.type(x, '100');
    await userEvent.click(screen.getByRole('button', { name: 'Go' }));
    await waitFor(() => expect(created[0]!.lookAt).toHaveBeenCalledWith(100, -132.49, 83.5));
    expect(created).toHaveLength(1);
  });

  it('shows that it is loading until the first of the world is drawn', async () => {
    clientHasEverything();
    render(<World3DScreen hasClient onClose={() => {}} />);
    expect(await screen.findByText('Loading the world…')).toBeInTheDocument();
    created[0]!.ready();
    await waitFor(() => expect(screen.queryByText('Loading the world…')).toBeNull());
  });

  it('says why when the world cannot start, and does not sit on "Loading" for ever', async () => {
    clientHasEverything();
    failing.on = true;
    render(<World3DScreen hasClient onClose={() => {}} />);
    expect(await screen.findByText('The 3D view could not start: WebGL is not available')).toBeInTheDocument();
    expect(screen.queryByText('Loading the world…')).toBeNull();
  });

  it('keeps a failure while leaving a world inside the view, so the screen and its controls stay', async () => {
    // The original crash: disposing the old world threw while React unmounted it, and took the screen down.
    clientHasEverything();
    const onClose = vi.fn();
    render(<World3DScreen hasClient onClose={onClose} />);
    await waitFor(() => expect(created).toHaveLength(1));
    created[0]!.dispose.mockImplementation(() => {
      throw new Error("Cannot read properties of undefined (reading 'getVolume')");
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Map' }), '1');
    expect(await screen.findByRole('alert')).toHaveTextContent('The 3D view stopped');
    expect(screen.getByRole('dialog', { name: '3D view' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(created.length).toBeGreaterThan(1));
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('leaves Esc to the view while something is selected in it, and closes on Esc otherwise', async () => {
    clientHasEverything();
    const onClose = vi.fn();
    render(<World3DScreen hasClient onClose={onClose} />);
    await waitFor(() => expect(created).toHaveLength(1));
    // What the real world does with its canvas while a spawn is selected
    const canvas = document.createElement('canvas');
    canvas.dataset.selection = 'on';
    document.body.appendChild(canvas);
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
    canvas.dataset.selection = '';
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    canvas.remove();
  });

  it('says while NPCs and objects are still loading, and how many areas are left', async () => {
    clientHasEverything();
    loadingAreas.n = 2;
    render(<World3DScreen hasClient onClose={() => {}} />);
    expect(await screen.findByText('Loading NPCs and objects… (2 areas)', {}, { timeout: 3000 })).toBeInTheDocument();
    loadingAreas.n = 1;
    expect(await screen.findByText('Loading NPCs and objects… (1 area)', {}, { timeout: 3000 })).toBeInTheDocument();
    loadingAreas.n = 0;
    await waitFor(() => expect(screen.queryByText(/Loading NPCs and objects/)).toBeNull(), { timeout: 3000 });
  });

  describe('the teleport panel', () => {
    const spot = (name: string, map?: number) => teleports.find((t) => t.name === name && (map === undefined || t.map === map))!;
    /** A button whose name starts with a spot's name (punctuation in names taken literally) */
    const startingWith = (text: string) => (name: string) => name.startsWith(text);

    it('jumps to a spot found by name, on the map the camera is on', async () => {
      clientHasEverything();
      render(<World3DScreen hasClient onClose={() => {}} />);
      await waitFor(() => expect(created).toHaveLength(1));
      await userEvent.click(screen.getByRole('button', { name: 'Teleport' }));
      const panel = screen.getByRole('dialog', { name: 'Teleport' });
      await userEvent.type(within(panel).getByRole('searchbox', { name: 'Find a place' }), 'Goldshire');
      await userEvent.click(within(panel).getByRole('button', { name: /^Goldshire/ }));
      const goldshire = spot('Goldshire', 0);
      await waitFor(() => expect(created[0]!.lookAt).toHaveBeenCalledWith(goldshire.x, goldshire.y, goldshire.z));
      expect(screen.queryByRole('dialog', { name: 'Teleport' })).toBeNull();
      expect((screen.getByLabelText('X') as HTMLInputElement).value).toBe(String(goldshire.x));
    });

    it('opens another continent at the spot', async () => {
      clientHasEverything();
      render(<World3DScreen hasClient onClose={() => {}} />);
      await waitFor(() => expect(created).toHaveLength(1));
      const kalimdor = teleports.find((t) => t.map === 1)!;
      await userEvent.click(screen.getByRole('button', { name: 'Teleport' }));
      await userEvent.type(screen.getByRole('searchbox', { name: 'Find a place' }), kalimdor.name);
      await userEvent.click(screen.getAllByRole('button', { name: startingWith(kalimdor.name) })[0]!);
      await waitFor(() => expect(created).toHaveLength(2));
      expect(created[1]).toMatchObject({ directory: 'kalimdor', map: 1, start: { x: kalimdor.x, y: kalimdor.y, z: kalimdor.z } });
    });

    it('cannot jump to a place the 3D view does not draw yet, and says so', async () => {
      clientHasEverything();
      render(<World3DScreen hasClient onClose={() => {}} />);
      await waitFor(() => expect(created).toHaveLength(1));
      const dungeon = teleports.find((t) => ![0, 1, 530, 571].includes(t.map))!;
      await userEvent.click(screen.getByRole('button', { name: 'Teleport' }));
      await userEvent.type(screen.getByRole('searchbox', { name: 'Find a place' }), dungeon.name);
      const button = screen.getAllByRole('button', { name: startingWith(dungeon.name) })[0]!;
      expect(button).toBeDisabled();
      expect(button).toHaveTextContent('Not drawn in 3D yet');
    });

    it('closes on Esc before the 3D screen does', async () => {
      clientHasEverything();
      const onClose = vi.fn();
      render(<World3DScreen hasClient onClose={onClose} />);
      await waitFor(() => expect(created).toHaveLength(1));
      await userEvent.click(screen.getByRole('button', { name: 'Teleport' }));
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('dialog', { name: 'Teleport' })).toBeNull();
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
