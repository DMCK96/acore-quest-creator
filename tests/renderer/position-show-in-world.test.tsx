// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PositionInput } from '../../src/renderer/scripts/PositionInput';
import { NamesProvider } from '../../src/renderer/state/names';
import { PlaceInWorldProvider, type PlaceInWorld } from '../../src/renderer/world3d/ShowInWorldContext';
import { makeMockApi } from './mock-api';

const wrap = (place: PlaceInWorld | null, ui: React.ReactNode) =>
  render(<NamesProvider api={makeMockApi()}><PlaceInWorldProvider value={place}>{ui}</PlaceInWorldProvider></NamesProvider>);

describe('a quest position’s Show in World', () => {
  it('asks the World to show the position’s marker', async () => {
    const place = vi.fn();
    wrap(place, <PositionInput idPrefix="p" value={{ x: 1, y: 2, z: 3, o: 0 }} onChange={() => {}} markerId="scene:s1:0:at" />);
    await userEvent.click(screen.getByRole('button', { name: 'Show in World' }));
    expect(place).toHaveBeenCalledWith({ kind: 'marker', id: 'scene:s1:0:at' });
    expect(screen.queryByRole('button', { name: 'Show on map' })).toBeNull();
  });

  it('is absent with no World (no game client)', () => {
    wrap(null, <PositionInput idPrefix="p" value={{ x: 1, y: 2, z: 3, o: 0 }} onChange={() => {}} markerId="x" />);
    expect(screen.queryByRole('button', { name: 'Show in World' })).toBeNull();
  });

  it('is absent for a position with no marker', () => {
    wrap(vi.fn(), <PositionInput idPrefix="p" value={{ x: 1, y: 2, z: 3, o: 0 }} onChange={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Show in World' })).toBeNull();
  });
});
