// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NamesProvider } from '../../src/renderer/state/names';
import { makeMockApi, nodeOf, okv, sampleOpen } from './mock-api';
import { clearClipboard } from '../../src/renderer/world3d/clipboard';
import { ENTITIES_FIELD, newNpc, newSpawn, writeEntities } from '../../src/core/entities/model';
import { markWelcomeSeen } from '../../src/renderer/world3d/welcome-seen';
import { writeLastPlace } from '../../src/renderer/world3d/last-place';

const worlds = vi.hoisted(() => [] as any[]);
vi.mock('../../src/renderer/world3d/world3d', () => ({
  createWorld3D: (options: any) => {
    const canvas = document.createElement('canvas');
    canvas.tabIndex = 0;
    options.container.appendChild(canvas);
    const world = { options, canvas, dispose: vi.fn(), lookAt: vi.fn(), setSpawnVisibility: vi.fn(), setOwnSpawns: vi.fn(), select: vi.fn(), selectSpawns: vi.fn(),
      setWorldLayer: vi.fn(), setMode: vi.fn(), setPlacing: vi.fn(), undo: vi.fn(), redo: vi.fn(), record: vi.fn(), setMarked: vi.fn(),
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

const EMPTY = { spawns: [], routes: [], added: [] };
const guard = { kind: 'creature' as const, guid: 80330, entry: 1423, name: 'Guard', own: false, added: false, pathId: 0, wander: 0, map: 0, placement: { x: 10, y: 0, z: 5, orientation: 1, rotation: null } };
const at = { x: 1, y: 2, z: 3 };

beforeEach(() => {
  clearClipboard();
  markWelcomeSeen('p');
  writeLastPlace({ map: 0, x: 0, y: 0, z: 0 });
});
afterEach(() => { worlds.length = 0; vi.unstubAllGlobals(); });

async function workspace(overrides: Record<string, unknown> = {}) {
  vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1]), { status: 200 }));
  const api = makeMockApi({ worldLayer: vi.fn(async () => okv(EMPTY)), ...overrides });
  const open = sampleOpen({ questId: 60001 });
  open.aggregate.values = {
    ...open.aggregate.values,
    [ENTITIES_FIELD]: writeEntities({ npcs: [{ ...newNpc(12000001), name: 'Hela', spawns: [{ ...newSpawn(900), map: 0, x: 1, y: 2, z: 3 }] }], objects: [], items: [] }),
  } as typeof open.aggregate.values;
  const onQuestField = vi.fn();
  const onNewQuest = vi.fn();
  render(
    <NamesProvider api={api}>
      <WorldWorkspace hasClient projectKey="p" projectName="P" onOpenSettings={vi.fn()} onShowQuests={vi.fn()} onStartQuest={vi.fn()}
        quest={{ open, nodes: [nodeOf({ questId: 60001 })] }} onQuestField={onQuestField} onNewQuest={onNewQuest} />
    </NamesProvider>,
  );
  await waitFor(() => expect(worlds).toHaveLength(1));
  return { api, world: worlds[0], onQuestField, onNewQuest };
}
const rightClick = (world: any, target: any) => act(() => world.options.onContextMenu(target, { x: 40, y: 40 }));

describe('quest actions in the World workspace', () => {
  it('Quest giver on a right-clicked NPC adds it to the open quest’s givers', async () => {
    const { world, onQuestField } = await workspace();
    rightClick(world, { ground: at, hit: { type: 'spawn', spawn: guard }, selection: [guard] });
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Quest giver' }));
    expect(onQuestField).toHaveBeenCalledWith('creature_queststarter', [{ id: 1423 }]);
    expect(onQuestField).toHaveBeenCalledWith('gameobject_queststarter', []);
  });

  it('Kill objective fills the first free slot', async () => {
    const { world, onQuestField } = await workspace();
    rightClick(world, { ground: at, hit: { type: 'spawn', spawn: guard }, selection: [guard] });
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Kill objective' }));
    expect(onQuestField).toHaveBeenCalledWith('quest_template.RequiredNpcOrGo', [
      { target: { target: 'creature', id: 1423 }, count: 1 }, { target: null, count: 0 }, { target: null, count: 0 }, { target: null, count: 0 }]);
  });

  it('Start the next quest in this chain hands the host the NPC and the open quest', async () => {
    const { world, onNewQuest } = await workspace();
    rightClick(world, { ground: at, hit: { type: 'spawn', spawn: guard }, selection: [guard] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Start the next quest in this chain' }));
    expect(onNewQuest).toHaveBeenCalledWith({ entry: 1423 }, 60001);
  });

  it('the open quest’s own spawns are drawn and edited in the World workspace', async () => {
    const { world, onQuestField } = await workspace();
    await waitFor(() => expect(world.setOwnSpawns).toHaveBeenCalledWith(expect.objectContaining({ creatures: [expect.objectContaining({ guid: 900, own: true })] })));
    act(() => world.options.onEdit({ kind: 'place', spawn: { kind: 'creature', guid: 900, entry: 12000001, own: true }, to: { x: 4, y: 5, z: 6, orientation: 0, rotation: null } }));
    expect(onQuestField).toHaveBeenCalledWith('entities', expect.anything());
  });

  it('Show quest spawns lists them by quest and role, marks those here, and Hide clears the marks', async () => {
    const questSpawnList = vi.fn(async () => okv([{ questId: 60001, title: 'Wolves', capped: false, spawns: [
      { kind: 'creature', guid: 80330, entry: 1423, name: 'Stormwind Guard', map: 0, x: 1, y: 2, z: 3, role: 'giver' },
      { kind: 'gameobject', guid: 5, entry: 143981, name: 'Mailbox', map: 1, x: 1, y: 2, z: 3, role: 'objective' },
    ] }]));
    const { world } = await workspace({ questSpawnList });
    rightClick(world, { ground: at, hit: null, selection: [] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Show quest spawns' }));
    expect(await screen.findByRole('heading', { name: 'Wolves: givers' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Wolves: objectives' })).toBeInTheDocument();
    expect(questSpawnList).toHaveBeenCalledWith([60001]);
    expect(world.setMarked).toHaveBeenLastCalledWith([{ kind: 'creature', guid: 80330 }]);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    rightClick(world, { ground: at, hit: null, selection: [] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Hide quest spawns' }));
    expect(world.setMarked).toHaveBeenLastCalledWith(null);
  });
});
