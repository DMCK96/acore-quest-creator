// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MapOpenerProvider } from '../../src/renderer/map/MapOpener';
import { PositionInput } from '../../src/renderer/scripts/PositionInput';
import { SpawnList } from '../../src/renderer/entities/SpawnList';
import { NamesProvider } from '../../src/renderer/state/names';
import { makeMockApi } from './mock-api';

const wrap = (open: (request: unknown) => void, ui: React.ReactNode) =>
  render(<NamesProvider api={makeMockApi()}><MapOpenerProvider open={open}>{ui}</MapOpenerProvider></NamesProvider>);

describe('Show on map', () => {
  it('opens the map on a position field', async () => {
    const open = vi.fn();
    wrap(open, <PositionInput idPrefix="p" value={{ x: 1, y: 2, z: 3, o: 0 }} onChange={() => {}} markerId="scene:s1:0:at" />);
    await userEvent.click(screen.getByRole('button', { name: 'Show on map' }));
    expect(open).toHaveBeenCalledWith('scene:s1:0:at');
  });
  it('opens the map on a spawn', async () => {
    const open = vi.fn();
    wrap(open, <SpawnList idPrefix="npc-1" ownerKey={{ kind: 'npc', entry: 12000001 }} spawns={[{ guid: 900, map: 0, x: 1, y: 2, z: 3, o: 0, respawnSecs: 300, wander: 0, patrol: null }]} wanders onChange={() => {}} allocate={async () => null} />);
    await userEvent.click(within(screen.getByText(/Spawn 1/).closest('li')!).getByRole('button', { name: 'Show on map' }));
    expect(open).toHaveBeenCalledWith('spawn:npc:12000001:900');
  });
  it('shows no link outside a quest map', () => {
    render(<NamesProvider api={makeMockApi()}><PositionInput idPrefix="p" value={{ x: 1, y: 2, z: 3, o: 0 }} onChange={() => {}} markerId="x" /></NamesProvider>);
    expect(screen.queryByRole('button', { name: 'Show on map' })).toBeNull();
  });
  it('offers a patrol for an NPC spawn and hides wander while it patrols', async () => {
    const open = vi.fn();
    const spawn = { guid: 900, map: 0, x: 1, y: 2, z: 3, o: 0, respawnSecs: 300, wander: 5, patrol: null };
    const patrol = { pathId: 9000, startPace: 'walk' as const, points: [
      { x: 1, y: 1, z: 1, waitSecs: 0, facing: null, paceFromHere: null, actions: [] },
      { x: 2, y: 2, z: 2, waitSecs: 0, facing: null, paceFromHere: null, actions: [] }] };
    const { rerender } = wrap(open, <SpawnList idPrefix="npc-1" ownerKey={{ kind: 'npc', entry: 12000001 }} spawns={[spawn]} wanders onChange={() => {}} allocate={async () => null} />);
    expect(screen.getByLabelText('Wander (yards)')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Draw patrol' }));
    expect(open).toHaveBeenCalledWith({ kind: 'patrol', entry: 12000001, guid: 900 });
    rerender(<NamesProvider api={makeMockApi()}><MapOpenerProvider open={open}><SpawnList idPrefix="npc-1" ownerKey={{ kind: 'npc', entry: 12000001 }} spawns={[{ ...spawn, patrol }]} wanders onChange={() => {}} allocate={async () => null} /></MapOpenerProvider></NamesProvider>);
    expect(screen.queryByLabelText('Wander (yards)')).toBeNull();
    expect(screen.getByText('Walks a patrol of 2 points.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit patrol' })).toBeTruthy();
  });
  it('offers no patrol for an object spawn', () => {
    wrap(vi.fn(), <SpawnList idPrefix="obj-1" ownerKey={{ kind: 'obj', entry: 9100001 }} spawns={[{ guid: 700, map: 0, x: 1, y: 2, z: 3, o: 0, respawnSecs: 300, wander: 0, patrol: null }]} wanders={false} onChange={() => {}} allocate={async () => null} />);
    expect(screen.queryByRole('button', { name: 'Draw patrol' })).toBeNull();
  });
});
