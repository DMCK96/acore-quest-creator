// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NamesProvider } from '../../src/renderer/state/names';
import { ProjectEntitiesProvider } from '../../src/renderer/state/project-entities';
import { makeMockApi, okv } from './mock-api';
import { clearClipboard } from '../../src/renderer/world3d/clipboard';
import { EMPTY_ENTITIES, type ProjectEntities } from '../../src/core/entities/model';
import { markWelcomeSeen } from '../../src/renderer/world3d/welcome-seen';
import { writeLastPlace } from '../../src/renderer/world3d/last-place';

const worlds = vi.hoisted(() => [] as any[]);
vi.mock('../../src/renderer/world3d/world3d', () => ({
  createWorld3D: (options: any) => {
    const canvas = document.createElement('canvas');
    canvas.tabIndex = 0;
    options.container.appendChild(canvas);
    const world = { options, canvas, dispose: vi.fn(), lookAt: vi.fn(), setSpawnVisibility: vi.fn(), setOwnSpawns: vi.fn(), select: vi.fn(), selectSpawns: vi.fn(),
      setWorldLayer: vi.fn(), setMode: vi.fn(), setPlacing: vi.fn(), cancelDrag: vi.fn(), setMarked: vi.fn(),
      setActive: vi.fn(), setScenery: vi.fn(), setTool: vi.fn(), setFalloff: vi.fn(), setPendingMovement: vi.fn(), spawnMovement: vi.fn(() => ({ type: 'idle', wander: 0, pathId: null })),
      startPath: vi.fn(), finishPath: vi.fn(), cancelPath: vi.fn(), undoPoint: vi.fn(), selectedSpawns: vi.fn(() => []), groundAt: vi.fn(() => null), lastPointer: vi.fn(() => null),
      spawnOf: vi.fn(() => ({})), routeOf: vi.fn(() => null),
      camera: () => ({ position: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }),
      target: () => ({ x: 0, y: 0, z: 0 }), spawnStatus: () => ({ capped: { creatures: false, objects: false }, error: null }) };
    worlds.push(world);
    return world;
  },
}));

import { WorldWorkspace } from '../../src/renderer/world3d/WorldWorkspace';

function mount(entities: ProjectEntities = EMPTY_ENTITIES) {
  vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1]), { status: 200 }));
  const api = makeMockApi({ worldLayer: vi.fn(async () => okv({ spawns: [], routes: [], added: [] })), allocateIds: vi.fn(async () => okv([6000007])),
    mapFloors: vi.fn(async () => okv({ floors: [31], ground: 31 })) });
  const state = { entities };
  const setEntities = vi.fn((next: ProjectEntities) => { state.entities = next; });
  const create = vi.fn(async () => ({ entry: 12000007 }));
  const adopt = vi.fn(async (_kind: string, entry: number) => ({ entry }));
  const ensure = vi.fn(async () => null);
  const value = () => ({ entities: state.entities, setEntities, quests: [], layer: { spawns: [], routes: [], added: [] }, setLayer: vi.fn(), tracked: state.entities.objects.map((o) => ({ kind: 'object' as const, entry: o.entry, name: o.name, origin: 'new' as const, changes: ['new' as const], usedBy: [], goTo: o.spawns[0] ? { kind: 'object' as const, guid: o.spawns[0].guid, map: o.spawns[0].map, x: o.spawns[0].x, y: o.spawns[0].y, z: o.spawns[0].z } : null })), create, remove: vi.fn(async () => null), adopt, ensure });
  const ui = () => (
    <NamesProvider api={api}>
      <ProjectEntitiesProvider value={value()}>
        <WorldWorkspace hasClient projectKey="p" projectName="P" onOpenSettings={vi.fn()} onShowQuests={vi.fn()} onStartQuest={vi.fn()} />
      </ProjectEntitiesProvider>
    </NamesProvider>
  );
  const view = render(ui());
  return { api, create, adopt, ensure, setEntities, rerender: () => view.rerender(ui()) };
}

beforeEach(() => {
  worlds.length = 0;
  clearClipboard();
  markWelcomeSeen('p');
  writeLastPlace({ map: 0, x: 0, y: 0, z: 0 });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function jumpToMapOne() {
  await userEvent.click(screen.getByRole('button', { name: 'Coordinates' }));
  await userEvent.selectOptions(screen.getByLabelText('Map'), '1');
  await userEvent.clear(screen.getByLabelText('X'));
  await userEvent.type(screen.getByLabelText('X'), '100');
  await userEvent.click(screen.getByRole('button', { name: 'Go' }));
}

describe('Back', () => {
  it('is disabled at first, returns to the place before a teleport (map included), then is disabled again', async () => {
    mount();
    await waitFor(() => expect(worlds).toHaveLength(1));
    const back = screen.getByRole('button', { name: 'Back' });
    expect(back).toHaveProperty('disabled', true);
    await jumpToMapOne();
    expect(back).toHaveProperty('disabled', false);
    expect(back.getAttribute('title')).toBe('Back to Eastern Kingdoms');
    await waitFor(() => expect(worlds.at(-1).options.map).toBe(1));
    await userEvent.click(back);
    await waitFor(() => expect(worlds.at(-1).options.map ?? 0).toBe(0));
    expect(screen.getByRole('button', { name: 'Back' })).toHaveProperty('disabled', true);
  });

  it('Alt+Left goes back', async () => {
    mount();
    await waitFor(() => expect(worlds).toHaveLength(1));
    await jumpToMapOne();
    await waitFor(() => expect(worlds.at(-1).options.map).toBe(1));
    expect(screen.getByRole('button', { name: 'Back' })).toHaveProperty('disabled', false);
    await userEvent.keyboard('{Alt>}{ArrowLeft}{/Alt}');
    await waitFor(() => expect(worlds.at(-1).options.map ?? 0).toBe(0));
    expect(screen.getByRole('button', { name: 'Back' })).toHaveProperty('disabled', true);
  });
});
