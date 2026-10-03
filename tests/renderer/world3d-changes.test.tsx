// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorldChanges } from '../../src/renderer/world3d/WorldChanges';
import { makeMockApi, okv } from './mock-api';

const spawn = { type: 'spawn', kind: 'creature', guid: 80330, entry: 1423, name: 'Stormwind Guard', map: 0, drifted: true,
  original: { x: -9481.31, y: 74.42, z: 56.55, orientation: 1.5, rotation: null }, current: { x: -9470, y: 74.42, z: 56.55, orientation: 2, rotation: null } };
const route = { type: 'route', pathId: 802, walkers: 3, drifted: false, original: [{ x: 1, y: 1, z: 1, rest: {} }, { x: 2, y: 2, z: 2, rest: {} }], current: [{ x: 1, y: 1, z: 1, rest: {} }] };

describe('the World changes modal', () => {
  it('lists each change with before and after, and says when the database moved since', async () => {
    const api = makeMockApi({ worldChanges: vi.fn(async () => okv([spawn, route])) });
    render(<WorldChanges api={api} onLayer={vi.fn()} onClose={vi.fn()} />);
    const dialog = await screen.findByRole('dialog', { name: 'World changes' });
    const rows = await within(dialog).findAllByRole('row');
    expect(rows[1]).toHaveTextContent('Stormwind Guard');
    expect(rows[1]).toHaveTextContent('80330');
    expect(rows[1]).toHaveTextContent('-9481.31, 74.42, 56.55');
    expect(rows[1]).toHaveTextContent('-9470.00, 74.42, 56.55');
    expect(rows[1]).toHaveTextContent('Changed in the database since');
    expect(rows[2]).toHaveTextContent('Route 802');
    expect(rows[2]).toHaveTextContent('3 spawns');
    expect(rows[2]).toHaveTextContent('2 points');
    expect(rows[2]).toHaveTextContent('1 point');
  });

  it('reverts one change and hands the new layer back', async () => {
    const layer = { spawns: [], routes: [], added: [] };
    const worldRevert = vi.fn(async () => okv(layer));
    const worldChanges = vi.fn().mockResolvedValueOnce(okv([spawn])).mockResolvedValue(okv([]));
    const onLayer = vi.fn();
    render(<WorldChanges api={makeMockApi({ worldChanges, worldRevert })} onLayer={onLayer} onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Revert Stormwind Guard' }));
    expect(worldRevert).toHaveBeenCalledWith({ kind: 'spawn', spawnKind: 'creature', guid: 80330 });
    await waitFor(() => expect(onLayer).toHaveBeenCalledWith(layer));
    expect(await screen.findByText('No world changes.')).toBeTruthy();
  });

  it('exports and shows where the two files went', async () => {
    const exportWorld = vi.fn(async () => okv({ applyPath: 'C:\\out\\2026-10-03_00_world.sql', revertPath: 'C:\\out\\2026-10-03_00_world_revert.sql', sql: '' }));
    render(<WorldChanges api={makeMockApi({ worldChanges: vi.fn(async () => okv([spawn])), exportWorld })} onLayer={vi.fn()} onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Export world patch' }));
    expect(await screen.findByText('C:\\out\\2026-10-03_00_world.sql')).toBeTruthy();
    expect(screen.getByText('C:\\out\\2026-10-03_00_world_revert.sql')).toBeTruthy();
  });

  it('says one spawn, not one spawns', async () => {
    render(<WorldChanges api={makeMockApi({ worldChanges: vi.fn(async () => okv([{ ...route, walkers: 1 }])) })} onLayer={vi.fn()} onClose={vi.fn()} />);
    const rows = await screen.findAllByRole('row');
    expect(rows[1]).toHaveTextContent('Route 802 · 1 spawn');
    expect(rows[1]).not.toHaveTextContent('1 spawns');
  });
});
