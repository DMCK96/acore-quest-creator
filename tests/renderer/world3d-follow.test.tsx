// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { NamesProvider } from '../../src/renderer/state/names';
import { ProjectEntitiesProvider } from '../../src/renderer/state/project-entities';
import { makeMockApi, okv } from './mock-api';
import { clearClipboard } from '../../src/renderer/world3d/clipboard';
import { EMPTY_ENTITIES } from '../../src/core/entities/model';
import { markWelcomeSeen } from '../../src/renderer/world3d/welcome-seen';
import { readLastPlace, writeLastPlace } from '../../src/renderer/world3d/last-place';

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
      hasSpawn: vi.fn(() => true), routeOf: vi.fn(() => null),
      camera: () => ({ position: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }),
      target: () => ({ x: 0, y: 0, z: 0 }), spawnStatus: () => ({ capped: { creatures: false, objects: false }, error: null }) };
    worlds.push(world);
    return world;
  },
}));

import { WorldWorkspace } from '../../src/renderer/world3d/WorldWorkspace';

type Props = { active?: boolean; follow?: { questId: number; at: number }; now?: () => number; showRequest?: { target: any; nonce: number } };

const giver = { kind: 'creature', guid: 6000001, entry: 12000001, name: 'Hela', map: 1, x: 500, y: 0, z: 0, role: 'giver' };
let api: ReturnType<typeof makeMockApi>;

function mount(first: Props, questSpawnList?: any) {
  vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1]), { status: 200 }));
  api = makeMockApi({ worldLayer: vi.fn(async () => okv({ spawns: [], routes: [], added: [] })),
    mapFloors: vi.fn(async () => okv({ floors: [31], ground: 31 })),
    questSpawnList: questSpawnList ?? (vi.fn(async () => okv([{ questId: 60001, title: 'Q', spawns: [giver], capped: false, cut: 0 }])) as any) });
  const value = { entities: EMPTY_ENTITIES, setEntities: vi.fn(), quests: [], layer: { spawns: [], routes: [], added: [] }, setLayer: vi.fn(), tracked: [],
    create: vi.fn(async () => ({ error: 'no' })), remove: vi.fn(async () => null), adopt: vi.fn(async () => ({ error: 'no' })), ensure: vi.fn(async () => null) };
  // The clock stays where the test puts it: by default before any quest was opened
  const now = first.now ?? (() => 0);
  const ui = (props: Props) => (
    <NamesProvider api={api}>
      <ProjectEntitiesProvider value={value}>
        <WorldWorkspace hasClient projectKey="p" projectName="P" onOpenSettings={vi.fn()} onShowQuests={vi.fn()} onStartQuest={vi.fn()}
          active={props.active} follow={props.follow} now={props.now ?? now} showRequest={props.showRequest} />
      </ProjectEntitiesProvider>
    </NamesProvider>
  );
  const view = render(ui(first));
  return { rerender: (props: Props) => view.rerender(ui(props)) };
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

describe('following a newly opened quest', () => {
  it('follows a quest opened while the World was hidden, when the World is next shown', async () => {
    const view = mount({ active: false, follow: { questId: 60001, at: 10 } });
    await waitFor(() => expect(worlds).toHaveLength(1));
    view.rerender({ active: true, follow: { questId: 60001, at: 10 } });
    await waitFor(() => expect(api.questSpawnList).toHaveBeenCalledWith([60001]));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Back' })).toHaveProperty('disabled', false));
    // The camera went to the giver, on its map
    await waitFor(() => expect(worlds.at(-1).options.map).toBe(1));
  });

  it('drops the follow when the camera moved after the quest was opened', { timeout: 8000 }, async () => {
    const view = mount({ active: false, follow: { questId: 60001, at: 10 }, now: () => 20 });
    await waitFor(() => expect(worlds).toHaveLength(1));
    // The author flies the camera at moment 20: the view reports where it rests on its next check
    worlds[0].target = () => ({ x: 40, y: 2, z: 3 });
    await waitFor(() => expect(readLastPlace().x).toBe(40), { timeout: 3000 });
    view.rerender({ active: true, follow: { questId: 60001, at: 10 } });
    await new Promise((r) => setTimeout(r, 50));
    expect(api.questSpawnList).not.toHaveBeenCalled();
  });

  it('records nothing for a quest opened while the World is shown', async () => {
    const view = mount({ active: true });
    await waitFor(() => expect(worlds).toHaveLength(1));
    view.rerender({ active: true, follow: { questId: 60001, at: 10 } });
    await new Promise((r) => setTimeout(r, 50));
    expect(api.questSpawnList).not.toHaveBeenCalled();
  });

  it('follows only once', async () => {
    const view = mount({ active: false, follow: { questId: 60001, at: 10 } });
    await waitFor(() => expect(worlds).toHaveLength(1));
    view.rerender({ active: true, follow: { questId: 60001, at: 10 } });
    await waitFor(() => expect(api.questSpawnList).toHaveBeenCalledTimes(1));
    view.rerender({ active: false, follow: { questId: 60001, at: 10 } });
    view.rerender({ active: true, follow: { questId: 60001, at: 10 } });
    await new Promise((r) => setTimeout(r, 50));
    expect(api.questSpawnList).toHaveBeenCalledTimes(1);
  });
});

describe('Show in World and Go to', () => {
  it('goes to the NPC asked for', async () => {
    const view = mount({ active: true });
    await waitFor(() => expect(worlds).toHaveLength(1));
    view.rerender({ active: true, showRequest: { target: { questId: 60001, kind: 'creature', entry: 12000001 }, nonce: 1 } });
    await waitFor(() => expect(worlds.at(-1).options.map).toBe(1));
    expect(screen.getByRole('button', { name: 'Back' })).toHaveProperty('disabled', false);
  });

  it('says so when nothing of the quest is placed', async () => {
    const view = mount({ active: true });
    await waitFor(() => expect(worlds).toHaveLength(1));
    view.rerender({ active: true, showRequest: { target: { questId: 60001, kind: 'creature', entry: 99 }, nonce: 1 } });
    expect(await screen.findByText('Nothing of this quest is placed in the world yet.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back' })).toHaveProperty('disabled', true);
  });

  it('says the world database is needed when the quest’s spawns cannot be read', async () => {
    const view = mount({ active: true }, vi.fn(async () => ({ ok: false, error: { code: 'NOT_CONNECTED', message: 'Connect to a world database first.' } })));
    await waitFor(() => expect(worlds).toHaveLength(1));
    view.rerender({ active: true, showRequest: { target: { questId: 60001 }, nonce: 1 } });
    expect(await screen.findByText('Needs the world database')).toBeTruthy();
    expect(screen.queryByText('Connect to a world database first.')).toBeNull();
  });

  it('offline, goes to a spawn of the project or the layer, and says the database is needed for any other', async () => {
    const offline = vi.fn(async () => okv([{ questId: 60001, title: 'Q', spawns: [giver], capped: false, cut: 0, offline: true }]));
    const view = mount({ active: true }, offline);
    await waitFor(() => expect(worlds).toHaveLength(1));
    view.rerender({ active: true, showRequest: { target: { questId: 60001, kind: 'creature', entry: 99 }, nonce: 1 } });
    expect(await screen.findByText('Needs the world database')).toBeTruthy();
    view.rerender({ active: true, showRequest: { target: { questId: 60001, kind: 'creature', entry: 12000001 }, nonce: 2 } });
    await waitFor(() => expect(worlds.at(-1).options.map).toBe(1));
  });
});
