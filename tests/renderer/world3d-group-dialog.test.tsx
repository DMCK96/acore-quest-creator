// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GroupDialog } from '../../src/renderer/world3d/GroupDialog';

const drake = { type: 'spawn' as const, kind: 'npc' as const, guid: 39203, entry: 32491, chance: 0 };
const vyragosa = { type: 'spawn' as const, kind: 'npc' as const, guid: 39207, entry: 32630, chance: 0 };
const group = { id: 900001, name: '', map: 571, maxActive: 1, members: [drake, vyragosa], origin: { kind: 'new' as const } };
const fine = { reasons: [], notes: [] };
const names = new Map([['npc:39203', 'Time-Lost Proto-Drake'], ['npc:39207', 'Vyragosa'], ['group:32493', 'Path 2']]);

describe('the group dialog', () => {
  it('names the group, sets how many are up and each chance, and saves', async () => {
    const onSave = vi.fn();
    render(<GroupDialog group={group} names={names} check={async () => fine} groupsOnMap={[]} onSave={onSave} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Spawn group' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Path 1');
    const row = within(dialog).getByRole('listitem', { name: 'Time-Lost Proto-Drake' });
    await userEvent.selectOptions(within(row).getByLabelText('Chance'), 'Percentage');
    await userEvent.clear(within(row).getByLabelText('Percent'));
    await userEvent.type(within(row).getByLabelText('Percent'), '10');
    expect(within(dialog).getByText('Vyragosa: 90% (equal share)')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({ ...group, name: 'Path 1', members: [{ ...drake, chance: 10 }, vyragosa] }, []);
  });

  it('shows why it cannot be saved and keeps Save disabled until fixed', async () => {
    const check = vi.fn(async (g: any) => ({ reasons: g.maxActive > g.members.length ? ['Up at once must be between 1 and the number of members.'] : [], notes: [] }));
    render(<GroupDialog group={group} names={names} check={check} groupsOnMap={[]} onSave={vi.fn()} onClose={vi.fn()} />);
    await userEvent.clear(screen.getByLabelText('Up at once'));
    await userEvent.type(screen.getByLabelText('Up at once'), '3');
    expect(await screen.findByText('Up at once must be between 1 and the number of members.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true);
    await userEvent.clear(screen.getByLabelText('Up at once'));
    await userEvent.type(screen.getByLabelText('Up at once'), '1');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', false));
  });

  it('offers to move a spawn from the group it is in, and saves with the move', async () => {
    const check = vi.fn(async (_g: any, moves: any[]) => ({ reasons: moves.length === 0 ? ['Spawn 39203 is already in group 32492.'] : [], notes: [] }));
    const onSave = vi.fn();
    render(<GroupDialog group={{ ...group, name: 'X' }} names={names} check={check} groupsOnMap={[]} onSave={onSave} onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Move Time-Lost Proto-Drake here' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', false));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(expect.anything(), [{ kind: 'npc', guid: 39203 }]);
  });

  it('adds another group on the map as a member, and removes a member', async () => {
    const onSave = vi.fn();
    render(<GroupDialog group={{ ...group, name: 'Drake' }} names={names} check={async () => fine} groupsOnMap={[{ id: 32493, name: 'Path 2' }]} onSave={onSave} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add a group…' }));
    await userEvent.click(screen.getByRole('option', { name: 'Path 2' }));
    await userEvent.click(within(screen.getByRole('listitem', { name: 'Vyragosa' })).getByRole('button', { name: 'Remove' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave.mock.calls[0]![0].members).toEqual([drake, { type: 'group', id: 32493, chance: 0 }]);
  });
  it('notes a group a move would empty without blocking Save', async () => {
    const check = vi.fn(async (_g: any, moves: any[]) => (moves.length === 0
      ? { reasons: ['Spawn 39203 is already in group 32492.'], notes: [] }
      : { reasons: [], notes: ['Path 1 would then be empty and is deleted.'] }));
    render(<GroupDialog group={{ ...group, name: 'X' }} names={names} check={check} groupsOnMap={[]} onSave={vi.fn()} onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Move Time-Lost Proto-Drake here' }));
    expect(await screen.findByText('Path 1 would then be empty and is deleted.')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', false));
  });
});
