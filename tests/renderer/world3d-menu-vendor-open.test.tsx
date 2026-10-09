// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useWorldMenu, type WorldMenuDeps } from '../../src/renderer/world3d/useWorldMenu';
import type { MenuSpawn } from '../../src/renderer/world3d/menu/model';
import { EMPTY_ENTITIES } from '../../src/core/entities/model';

const placement = { x: 1, y: 2, z: 3, orientation: 0, rotation: null };
const guard = { kind: 'creature', guid: 80330, entry: 1423, name: 'Guard', own: false, added: false, pathId: 0, wander: 0, map: 0, placement, group: null, respawnSecs: 300, npcFlags: 129 } as MenuSpawn;

function Harness({ deps, spawn = guard }: { deps: WorldMenuDeps; spawn?: MenuSpawn }) {
  const menu = useWorldMenu(deps);
  useEffect(() => menu.open({ ground: placement, hit: { type: 'spawn', spawn }, selection: [spawn] }, { x: 10, y: 10 }), []);
  return menu.elements;
}

afterEach(cleanup);

describe('opening an NPC from the right-click menu on its Vendor tab', () => {
  it('hands the tab to the view with the NPC', async () => {
    const onEditEntity = vi.fn();
    const deps = {
      world: { current: { setMarked: vi.fn(), frameOfSpawn: () => null } }, api: {}, map: 0, vessel: false, placing: false, newPaths: new Set<number>(),
      entities: EMPTY_ENTITIES, onEditEntity, isNewPath: () => false, send: async () => true, takeLayer: vi.fn(), setNote: vi.fn(), floorZ: async () => null,
      toRow: (at: unknown) => at, stopPlacing: vi.fn(), clearSelection: vi.fn(), focusView: vi.fn(), viewCentre: () => ({ x: 0, y: 0 }),
    } as unknown as WorldMenuDeps;
    render(<Harness deps={deps} />);
    await userEvent.click(await screen.findByRole('menuitem', { name: /Edit vendor stock…/ }));
    expect(onEditEntity).toHaveBeenCalledWith('creature', 1423, 'vendor');
  });

  it('hands the Trainer tab to the view for an NPC whose flags say it trains', async () => {
    const onEditEntity = vi.fn();
    const deps = {
      world: { current: { setMarked: vi.fn(), frameOfSpawn: () => null } }, api: {}, map: 0, vessel: false, placing: false, newPaths: new Set<number>(),
      entities: EMPTY_ENTITIES, onEditEntity, isNewPath: () => false, send: async () => true, takeLayer: vi.fn(), setNote: vi.fn(), floorZ: async () => null,
      toRow: (at: unknown) => at, stopPlacing: vi.fn(), clearSelection: vi.fn(), focusView: vi.fn(), viewCentre: () => ({ x: 0, y: 0 }),
    } as unknown as WorldMenuDeps;
    render(<Harness deps={deps} spawn={{ ...guard, npcFlags: 51 } as MenuSpawn} />);
    await userEvent.click(await screen.findByRole('menuitem', { name: /Edit trainer spells…/ }));
    expect(onEditEntity).toHaveBeenCalledWith('creature', 1423, 'trainer');
  });

  it('hands the Gossip tab to the view for an NPC whose template has a menu', async () => {
    const onEditEntity = vi.fn();
    const deps = {
      world: { current: { setMarked: vi.fn(), frameOfSpawn: () => null } }, api: {}, map: 0, vessel: false, placing: false, newPaths: new Set<number>(),
      entities: EMPTY_ENTITIES, onEditEntity, isNewPath: () => false, send: async () => true, takeLayer: vi.fn(), setNote: vi.fn(), floorZ: async () => null,
      toRow: (at: unknown) => at, stopPlacing: vi.fn(), clearSelection: vi.fn(), focusView: vi.fn(), viewCentre: () => ({ x: 0, y: 0 }),
    } as unknown as WorldMenuDeps;
    render(<Harness deps={deps} spawn={{ ...guard, gossipMenuId: 5000 } as MenuSpawn} />);
    await userEvent.click(await screen.findByRole('menuitem', { name: /Edit gossip menu…/ }));
    expect(onEditEntity).toHaveBeenCalledWith('creature', 1423, 'gossip');
  });
});
