// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const created = vi.hoisted(() => [] as { map: number; start?: unknown; lookAt: ReturnType<typeof vi.fn> }[]);
vi.mock('../../src/renderer/world3d/world3d', () => ({
  createWorld3D: (options: { map: number; start: unknown }) => {
    const world = {
      map: options.map, start: options.start, dispose: vi.fn(), lookAt: vi.fn(), setSpawnVisibility: vi.fn(), setActive: vi.fn(),
      target: () => ({ x: 0, y: 0, z: 0 }), spawnStatus: () => ({ capped: { creatures: false, objects: false }, error: null, loading: 0 }),
    };
    created.push(world);
    return world;
  },
}));

import { WorldWorkspace } from '../../src/renderer/world3d/WorldWorkspace';
import teleports from '../../src/core/map/teleports.json';

const props = (over: Partial<React.ComponentProps<typeof WorldWorkspace>> = {}) => ({
  hasClient: true, projectKey: 'C:\w\north.aqc', projectName: 'North', onOpenSettings: vi.fn(), onShowQuests: vi.fn(), onStartQuest: vi.fn(), ...over,
});
const clientHasEverything = () => vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1]), { status: 200 }));
const seen = () => JSON.parse(localStorage.getItem('acqc.welcome.seen') ?? '[]');
afterEach(() => {
  created.length = 0;
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('the welcome', () => {
  it('greets a project the first time, over the orb, with places to start from', async () => {
    clientHasEverything();
    render(<WorldWorkspace {...props()} />);
    const welcome = await screen.findByRole('dialog', { name: 'Welcome' });
    expect(within(welcome).getByRole('heading', { name: 'Welcome to North' })).toBeInTheDocument();
    expect(within(within(welcome).getByRole('list', { name: 'Well-known places' })).getByRole('button', { name: 'Goldshire' })).toBeInTheDocument();
    expect(within(welcome).getByRole('searchbox', { name: 'Find a place' })).toBeInTheDocument();
    expect(document.querySelector('.welcome__orb[data-orb-target] .quest-orb')).not.toBeNull();
  });

  it('says just "Welcome" for a project with no name', async () => {
    clientHasEverything();
    render(<WorldWorkspace {...props({ projectName: '  ' })} />);
    expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
  });

  it('goes to a well-known place and does not greet that project again', async () => {
    clientHasEverything();
    const { unmount } = render(<WorldWorkspace {...props()} />);
    await waitFor(() => expect(created).toHaveLength(1));
    await userEvent.click(within(await screen.findByRole('list', { name: 'Well-known places' })).getByRole('button', { name: 'Goldshire' }));
    const goldshire = teleports.find((t) => t.name === 'Goldshire' && t.map === 0)!;
    await waitFor(() => expect(created[0]!.lookAt).toHaveBeenCalledWith(goldshire.x, goldshire.y, goldshire.z));
    expect(screen.queryByRole('dialog', { name: 'Welcome' })).toBeNull();
    expect(seen()).toEqual(['C:\w\north.aqc']);
    unmount();
    render(<WorldWorkspace {...props()} />);
    await waitFor(() => expect(created.length).toBeGreaterThan(1));
    expect(screen.queryByRole('dialog', { name: 'Welcome' })).toBeNull();
  });

  it('goes to a place found by name', async () => {
    clientHasEverything();
    render(<WorldWorkspace {...props()} />);
    await waitFor(() => expect(created).toHaveLength(1));
    const welcome = await screen.findByRole('dialog', { name: 'Welcome' });
    await userEvent.type(within(welcome).getByRole('searchbox', { name: 'Find a place' }), 'Ironforge');
    await userEvent.click(within(welcome).getAllByRole('button', { name: /^Ironforge/ })[0]!);
    expect(screen.queryByRole('dialog', { name: 'Welcome' })).toBeNull();
  });

  it('opens Find, starts a quest, or just closes, and each one counts as seen', async () => {
    clientHasEverything();
    const onStartQuest = vi.fn();
    const first = render(<WorldWorkspace {...props({ projectKey: 'a' })} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Find an NPC or object' }));
    expect(screen.getByRole('dialog', { name: 'Find an NPC or object' })).toBeInTheDocument();
    first.unmount();
    const second = render(<WorldWorkspace {...props({ projectKey: 'b', onStartQuest })} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Start a quest' }));
    expect(onStartQuest).toHaveBeenCalledTimes(1);
    second.unmount();
    render(<WorldWorkspace {...props({ projectKey: 'c' })} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Just look around' }));
    expect(screen.queryByRole('dialog', { name: 'Welcome' })).toBeNull();
    expect(seen()).toEqual(['a', 'b', 'c']);
  }, 15000);

  it('closes on Esc', async () => {
    clientHasEverything();
    render(<WorldWorkspace {...props()} />);
    await screen.findByRole('dialog', { name: 'Welcome' });
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Welcome' })).toBeNull();
    expect(seen()).toEqual(['C:\w\north.aqc']);
  });

  it('waits for a project opened while the world is hidden, and greets it when shown', async () => {
    clientHasEverything();
    const { rerender } = render(<WorldWorkspace {...props({ active: false })} />);
    await waitFor(() => expect(created).toHaveLength(1));
    expect(screen.queryByRole('dialog', { name: 'Welcome' })).toBeNull();
    rerender(<WorldWorkspace {...props({ active: true })} />);
    expect(await screen.findByRole('dialog', { name: 'Welcome' })).toBeInTheDocument();
  });
});
