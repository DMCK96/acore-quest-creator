// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const created = vi.hoisted(() => [] as { directory: string; map: number; start?: unknown; dispose: ReturnType<typeof vi.fn>; lookAt: ReturnType<typeof vi.fn>; ready: () => void }[]);
const failing = vi.hoisted(() => ({ on: false }));
const loadingAreas = vi.hoisted(() => ({ n: 0 }));

vi.mock('../../src/renderer/world3d/world3d', () => ({
  createWorld3D: (options: { directory: string; map: number; start: unknown; onReady?: () => void }) => {
    if (failing.on) throw new Error('WebGL is not available');
    const world = {
      directory: options.directory, map: options.map, start: options.start, dispose: vi.fn(), cancelPath: vi.fn(), lookAt: vi.fn(), ready: () => options.onReady?.(),
      setSpawnVisibility: vi.fn(), setActive: vi.fn(), setScenery: vi.fn(), setTool: vi.fn(), setFalloff: vi.fn(), target: () => ({ x: 0, y: 0, z: 0 }), spawnStatus: () => ({ capped: { creatures: false, objects: false }, error: null, loading: loadingAreas.n }),
    };
    created.push(world);
    return world;
  },
}));

import { WorldWorkspace } from '../../src/renderer/world3d/WorldWorkspace';
import teleports from '../../src/core/map/teleports.json';

const props = (over: Partial<React.ComponentProps<typeof WorldWorkspace>> = {}) => ({
  hasClient: true, projectKey: 'seen', projectName: 'North', onOpenSettings: vi.fn(), onShowQuests: vi.fn(), onStartQuest: vi.fn(), ...over,
});
const openCoordinates = () => userEvent.click(screen.getByRole('button', { name: 'Coordinates' }));
beforeEach(() => localStorage.setItem('acqc.welcome.seen', JSON.stringify(['seen'])));

afterEach(() => {
  localStorage.clear();
  created.length = 0;
  failing.on = false;
  loadingAreas.n = 0;
  vi.unstubAllGlobals();
});

const clientHasEverything = () => vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1]), { status: 200 }));

describe('the World workspace', () => {
  it('builds a world for the map, and replaces it (disposing the old one) when another continent is chosen', async () => {
    clientHasEverything();
    render(<WorldWorkspace {...props()} />);
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({ directory: 'azeroth', map: 0 });
    await openCoordinates();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Map' }), '1');
    await waitFor(() => expect(created).toHaveLength(2));
    expect(created[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(created[1]).toMatchObject({ directory: 'kalimdor', map: 1 });
    expect(screen.getByRole('region', { name: 'World' })).toBeInTheDocument();
  });

  it('moves the camera of the world it has when Go is pressed, instead of building another', async () => {
    clientHasEverything();
    render(<WorldWorkspace {...props()} />);
    await waitFor(() => expect(created).toHaveLength(1));
    await openCoordinates();
    const x = screen.getByLabelText('X');
    await userEvent.clear(x);
    await userEvent.type(x, '100');
    await userEvent.click(screen.getByRole('button', { name: 'Go' }));
    await waitFor(() => expect(created[0]!.lookAt).toHaveBeenCalledWith(100, -132.49, 83.5));
    expect(created).toHaveLength(1);
  });

  it('shows that it is loading until the first of the world is drawn', async () => {
    clientHasEverything();
    render(<WorldWorkspace {...props()} />);
    expect(await screen.findByText('Loading the world…')).toBeInTheDocument();
    created[0]!.ready();
    await waitFor(() => expect(screen.queryByText('Loading the world…')).toBeNull());
  });

  it('says why when the world cannot start, and does not sit on "Loading" for ever', async () => {
    clientHasEverything();
    failing.on = true;
    render(<WorldWorkspace {...props()} />);
    expect(await screen.findByText('The 3D view could not start: WebGL is not available')).toBeInTheDocument();
    expect(screen.queryByText('Loading the world…')).toBeNull();
  });

  it('keeps a failure while leaving a world inside the view, so the screen and its controls stay', async () => {
    // The original crash: disposing the old world threw while React unmounted it, and took the screen down.
    clientHasEverything();
    render(<WorldWorkspace {...props()} />);
    await waitFor(() => expect(created).toHaveLength(1));
    created[0]!.dispose.mockImplementation(() => {
      throw new Error("Cannot read properties of undefined (reading 'getVolume')");
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await openCoordinates();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Map' }), '1');
    expect(await screen.findByRole('alert')).toHaveTextContent('The 3D view stopped');
    expect(screen.getByRole('region', { name: 'World' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(created.length).toBeGreaterThan(1));
    expect(screen.getByRole('button', { name: 'Teleport' })).toBeInTheDocument();
  });

  it('does not leave on Esc: Esc only closes its own panels and the selection', async () => {
    clientHasEverything();
    render(<WorldWorkspace {...props()} />);
    await waitFor(() => expect(created).toHaveLength(1));
    await userEvent.click(screen.getByRole('button', { name: 'Teleport' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Teleport' })).toBeNull();
    await openCoordinates();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByLabelText('X')).toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('region', { name: 'World' })).toBeInTheDocument();
  });

  it('opens where the world was left, and remembers each jump', async () => {
    clientHasEverything();
    localStorage.setItem('acqc.world.lastPlace', JSON.stringify({ map: 1, x: 5, y: 6, z: 7 }));
    render(<WorldWorkspace {...props()} />);
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({ directory: 'kalimdor', map: 1, start: { x: 5, y: 6, z: 7 } });
    await openCoordinates();
    const x = screen.getByLabelText('X');
    await userEvent.clear(x);
    await userEvent.type(x, '100');
    await userEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(JSON.parse(localStorage.getItem('acqc.world.lastPlace')!)).toEqual({ map: 1, x: 100, y: 6, z: 7 });
  });

  it('names the place it is looking at in its place card', async () => {
    clientHasEverything();
    render(<WorldWorkspace {...props()} />);
    await waitFor(() => expect(created).toHaveLength(1));
    const card = screen.getByRole('region', { name: 'Place' });
    expect(within(card).getByRole('heading')).toHaveTextContent('Eastern Kingdoms');
  });

  it('without a game client, says why and offers settings or the quests', async () => {
    const onOpenSettings = vi.fn();
    const onShowQuests = vi.fn();
    render(<WorldWorkspace {...props({ hasClient: false, projectKey: 'new', onOpenSettings, onShowQuests })} />);
    expect(screen.getByRole('heading', { name: 'See the world in 3D' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /Welcome/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    await userEvent.click(screen.getByRole('button', { name: 'Go to Quests' }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onShowQuests).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(0);
  });

  it('says while NPCs and objects are still loading, and how many areas are left', async () => {
    clientHasEverything();
    loadingAreas.n = 2;
    render(<WorldWorkspace {...props()} />);
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
      render(<WorldWorkspace {...props()} />);
      await waitFor(() => expect(created).toHaveLength(1));
      await userEvent.click(screen.getByRole('button', { name: 'Teleport' }));
      const panel = screen.getByRole('dialog', { name: 'Teleport' });
      await userEvent.type(within(panel).getByRole('searchbox', { name: 'Find a place' }), 'Goldshire');
      await userEvent.click(within(panel).getByRole('button', { name: /^Goldshire/ }));
      const goldshire = spot('Goldshire', 0);
      await waitFor(() => expect(created[0]!.lookAt).toHaveBeenCalledWith(goldshire.x, goldshire.y, goldshire.z));
      expect(screen.queryByRole('dialog', { name: 'Teleport' })).toBeNull();
      await openCoordinates();
      expect((screen.getByLabelText('X') as HTMLInputElement).value).toBe(String(goldshire.x));
    });

    it('opens another continent at the spot', async () => {
      clientHasEverything();
      render(<WorldWorkspace {...props()} />);
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
      render(<WorldWorkspace {...props()} />);
      await waitFor(() => expect(created).toHaveLength(1));
      const dungeon = teleports.find((t) => ![0, 1, 530, 571].includes(t.map))!;
      await userEvent.click(screen.getByRole('button', { name: 'Teleport' }));
      await userEvent.type(screen.getByRole('searchbox', { name: 'Find a place' }), dungeon.name);
      const button = screen.getAllByRole('button', { name: startingWith(dungeon.name) })[0]!;
      expect(button).toBeDisabled();
      expect(button).toHaveTextContent('Not drawn in 3D yet');
    });
  });
});
