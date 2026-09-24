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
});
