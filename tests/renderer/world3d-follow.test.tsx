// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { NamesProvider } from '../../src/renderer/state/names';
import { ProjectEntitiesProvider } from '../../src/renderer/state/project-entities';
import { makeMockApi, okv } from './mock-api';
import { clearClipboard } from '../../src/renderer/world3d/clipboard';
import { EMPTY_ENTITIES } from '../../src/core/entities/model';
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
      setScenery: vi.fn(), setTool: vi.fn(), setFalloff: vi.fn(), setPendingMovement: vi.fn(), spawnMovement: vi.fn(() => ({ type: 'idle', wander: 0, pathId: null })),
      startPath: vi.fn(), finishPath: vi.fn(), cancelPath: vi.fn(), undoPoint: vi.fn(), selectedSpawns: vi.fn(() => []), groundAt: vi.fn(() => null), lastPointer: vi.fn(() => null),
      spawnOf: vi.fn(() => ({})), routeOf: vi.fn(() => null),
      camera: () => ({ position: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }),
      target: () => ({ x: 0, y: 0, z: 0 }), spawnStatus: () => ({ capped: { creatures: false, objects: false }, error: null }) };
    worlds.push(world);
    return world;
  },
}));

import { WorldWorkspace } from '../../src/renderer/world3d/WorldWorkspace';

type Focus = { questId: number | null; part: { kind: 'creature' | 'gameobject'; entry: number } | null; nonce: number; at: number };
type Props = { focus?: Focus; now?: () => number };
/** A focus set at moment 10, after the clock's start */
const quest = (nonce = 1): Focus => ({ questId: 60001, part: null, nonce, at: 10 });
const part = (entry: number, nonce = 1): Focus => ({ questId: 60001, part: { kind: 'creature', entry }, nonce, at: 10 });

const giver = { kind: 'creature', guid: 6000001, entry: 12000001, name: 'Hela', map: 1, x: 500, y: 0, z: 0, role: 'giver' };
let api: ReturnType<typeof makeMockApi>;

function mount(first: Props, questSpawnList?: any) {
  vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1]), { status: 200 }));
  api = makeMockApi({ worldLayer: vi.fn(async () => okv({ spawns: [], routes: [], added: [] })),
    mapFloors: vi.fn(async () => okv({ floors: [31], ground: 31 })),
    questSpawnList: questSpawnList ?? (vi.fn(async () => okv([{ questId: 60001, title: 'Q', spawns: [giver], capped: false, cut: 0 }])) as any) });
  const value = { entities: EMPTY_ENTITIES, setEntities: vi.fn(), quests: [], layer: { spawns: [], routes: [], added: [] }, setLayer: vi.fn(), tracked: [],
    create: vi.fn(async () => ({ error: 'no' })), remove: vi.fn(async () => null), adopt: vi.fn(async () => ({ error: 'no' })), ensure: vi.fn(async () => null) };
  // The clock stays where the test puts it: by default before any focus was set
  const now = first.now ?? (() => 0);
  const ui = (props: Props) => (
    <NamesProvider api={api}>
      <ProjectEntitiesProvider value={value}>
        <WorldWorkspace hasClient projectKey="p" projectName="P" onOpenSettings={vi.fn()} onShowQuests={vi.fn()} onStartQuest={vi.fn()}
          focus={props.focus} now={props.now ?? now} />
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

describe('following the focus', () => {
  it('goes to a newly focused quest', async () => {
    const view = mount({});
    await waitFor(() => expect(worlds).toHaveLength(1));
    view.rerender({ focus: quest() });
    await waitFor(() => expect(api.questSpawnList).toHaveBeenCalledWith([60001]));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Back' })).toHaveProperty('disabled', false));
    // The camera went to the giver, on its map
    await waitFor(() => expect(worlds.at(-1).options.map).toBe(1));
  });

  it('leaves the camera where the author moved it after the focus was set', async () => {
    const view = mount({ now: () => 20 });
    await waitFor(() => expect(worlds).toHaveLength(1));
    // The author flies the camera at moment 20
    worlds[0].options.onCameraInput();
    view.rerender({ focus: quest() });
    await new Promise((r) => setTimeout(r, 50));
    expect(api.questSpawnList).not.toHaveBeenCalled();
    expect(worlds).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Back' })).toHaveProperty('disabled', true);
  });

  it('still selects a focused NPC in view when the author moved the camera, and does not move it', async () => {
    const near = { ...giver, map: 0, x: 100, y: 2, z: 3 };
    const view = mount({ now: () => 20 }, vi.fn(async () => okv([{ questId: 60001, title: 'Q', spawns: [near], capped: false, cut: 0 }])));
    await waitFor(() => expect(worlds).toHaveLength(1));
    worlds[0].options.onCameraInput();
    view.rerender({ focus: part(12000001) });
    await waitFor(() => expect(worlds[0].select).toHaveBeenCalledWith({ kind: 'creature', guid: 6000001 }));
    expect(worlds[0].lookAt).not.toHaveBeenCalledWith(100, 2, 4, true);
    expect(screen.getByRole('button', { name: 'Back' })).toHaveProperty('disabled', true);
  });

  // The view says so as the author starts moving the camera, not only once it rests
  it('leaves the camera alone when the author moves it while the quest’s place is read', async () => {
    let clock = 5;
    let answer: (value: unknown) => void = () => {};
    const view = mount({ now: () => clock }, vi.fn(() => new Promise((resolve) => { answer = resolve; })));
    await waitFor(() => expect(worlds).toHaveLength(1));
    view.rerender({ focus: quest(), now: () => clock });
    await waitFor(() => expect(api.questSpawnList).toHaveBeenCalledTimes(1));
    clock = 20;
    worlds[0].options.onCameraInput();
    answer(okv([{ questId: 60001, title: 'Q', spawns: [giver], capped: false, cut: 0 }]));
    await new Promise((r) => setTimeout(r, 50));
    expect(worlds).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Back' })).toHaveProperty('disabled', true);
  });

  it('follows each focus once', async () => {
    const view = mount({});
    await waitFor(() => expect(worlds).toHaveLength(1));
    view.rerender({ focus: quest() });
    await waitFor(() => expect(api.questSpawnList).toHaveBeenCalledTimes(1));
    view.rerender({ focus: quest() });
    await new Promise((r) => setTimeout(r, 50));
    expect(api.questSpawnList).toHaveBeenCalledTimes(1);
  });
});

describe('a focused NPC or object (Show in World and Go to)', () => {
  it('goes to the NPC asked for, and selects it', async () => {
    const view = mount({});
    await waitFor(() => expect(worlds).toHaveLength(1));
    view.rerender({ focus: part(12000001) });
    await waitFor(() => expect(worlds.at(-1).options.map).toBe(1));
    expect(screen.getByRole('button', { name: 'Back' })).toHaveProperty('disabled', false);
    await waitFor(() => expect(worlds.at(-1).select).toHaveBeenCalledWith({ kind: 'creature', guid: 6000001 }));
  });

  it('says so when nothing of the quest is placed', async () => {
    const view = mount({}, vi.fn(async () => okv([{ questId: 60001, title: 'Q', spawns: [], capped: false, cut: 0 }])));
    await waitFor(() => expect(worlds).toHaveLength(1));
    view.rerender({ focus: quest() });
    expect(await screen.findByText('Nothing of this quest is placed in the world yet.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back' })).toHaveProperty('disabled', true);
  });

  it('takes its note back once a later focus is followed', async () => {
    const empty = { questId: 60001, title: 'Q', spawns: [], capped: false, cut: 0 };
    const placed = { questId: 60001, title: 'Q', spawns: [giver], capped: false, cut: 0 };
    const list = vi.fn().mockResolvedValueOnce(okv([empty])).mockResolvedValue(okv([placed]));
    const view = mount({}, list);
    await waitFor(() => expect(worlds).toHaveLength(1));
    view.rerender({ focus: quest(1) });
    expect(await screen.findByText('Nothing of this quest is placed in the world yet.')).toBeTruthy();
    view.rerender({ focus: quest(2) });
    await waitFor(() => expect(screen.queryByText('Nothing of this quest is placed in the world yet.')).toBeNull());
    // Another note is not the follow's to take back
    view.rerender({ focus: part(99, 3) });
    expect(await screen.findByText('NPC #99 has no spawn in the world yet.')).toBeTruthy();
  });

  it('says the NPC has no spawn when one named NPC is not placed', async () => {
    const view = mount({});
    await waitFor(() => expect(worlds).toHaveLength(1));
    view.rerender({ focus: part(99) });
    expect(await screen.findByText('NPC #99 has no spawn in the world yet.')).toBeTruthy();
  });

  it('says why the spawns could not be read while connected', async () => {
    const view = mount({}, vi.fn(async () => ({ ok: false, error: { code: 'QUERY', message: 'Lost connection' } })));
    await waitFor(() => expect(worlds).toHaveLength(1));
    view.rerender({ focus: quest() });
    expect(await screen.findByText('Could not read the quest’s spawns: Lost connection')).toBeTruthy();
  });

  it('says the world database is needed when the quest’s spawns cannot be read', async () => {
    const view = mount({}, vi.fn(async () => ({ ok: false, error: { code: 'NOT_CONNECTED', message: 'Connect to a world database first.' } })));
    await waitFor(() => expect(worlds).toHaveLength(1));
    view.rerender({ focus: quest() });
    expect(await screen.findByText('Needs the world database')).toBeTruthy();
    expect(screen.queryByText('Connect to a world database first.')).toBeNull();
  });

  it('offline, goes to a spawn of the project or the layer, and says the database is needed for any other', async () => {
    const offline = vi.fn(async () => okv([{ questId: 60001, title: 'Q', spawns: [giver], capped: false, cut: 0, offline: true }]));
    const view = mount({}, offline);
    await waitFor(() => expect(worlds).toHaveLength(1));
    view.rerender({ focus: part(99) });
    expect(await screen.findByText('Needs the world database')).toBeTruthy();
    view.rerender({ focus: part(12000001, 2) });
    await waitFor(() => expect(worlds.at(-1).options.map).toBe(1));
  });
});
