// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RotationDialog } from '../../src/renderer/views/RotationDialog';

const q = (questId: number) => ({ type: 'quest' as const, questId });
const group = { id: 900010, name: '', map: 0, maxActive: 1, members: [q(60001), q(60002)], origin: { kind: 'new' as const }, event: null };
const titles = new Map([[60001, { title: 'Wolves', daily: true, weekly: false }], [60002, { title: 'Boars', daily: false, weekly: false }]]);
const ok = async () => ({ reasons: [], notes: [] });

describe('the rotation dialog', () => {
  it('names the rotation, picks daily, how many each reset, and saves with the quests made daily', async () => {
    const onSave = vi.fn();
    render(<RotationDialog group={group} titles={titles} projectQuests={[]} check={ok} onSave={onSave} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Quest rotation' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Dailies');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Daily' }));
    expect(within(dialog).getByRole('button', { name: 'Make Boars daily' })).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Make them all daily' }));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Save' })).toHaveProperty('disabled', false));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({ ...group, name: 'Dailies' }, [], 'daily');
  });

  it('limits Offered each reset to the number of quests, and shows the reasons it cannot save', async () => {
    const check = vi.fn(async (g: any) => ({ reasons: g.members.length < 2 ? ['A rotation needs at least two quests.'] : [], notes: [] }));
    render(<RotationDialog group={group} titles={titles} projectQuests={[]} check={check} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByLabelText('Offered each reset')).toHaveProperty('max', '2');
    await userEvent.click(within(screen.getByRole('listitem', { name: 'Boars' })).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('A rotation needs at least two quests.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true);
  });

  it('moves a quest from the rotation it is in, and deletes an existing rotation', async () => {
    const check = vi.fn(async (_g: any, moves: any[]) => ({ reasons: moves.length ? [] : ['Wolves is already in rotation Old.'], notes: [] }));
    const onDelete = vi.fn();
    render(<RotationDialog group={{ ...group, name: 'X' }} titles={titles} projectQuests={[]} check={check} onSave={vi.fn()} onDelete={onDelete} onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Move Wolves here' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete rotation' }));
    expect(onDelete).toHaveBeenCalled();
  });

  it('adds another project quest, and a quest of the other kind blocks saving until it is made this kind', async () => {
    const onSave = vi.fn();
    const both = new Map([...titles, [60003, { title: 'Bears', daily: false, weekly: true }]]);
    render(
      <RotationDialog
        group={group}
        titles={both}
        projectQuests={[{ questId: 60003, title: 'Bears' }, { questId: 60001, title: 'Wolves' }]}
        check={ok}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add a quest…' }));
    const choices = screen.getByRole('listbox', { name: 'Project quests' });
    expect(within(choices).queryByText(/Wolves/)).toBeNull();
    await userEvent.click(within(choices).getByRole('option', { name: /Bears/ }));
    expect(screen.getByRole('listitem', { name: 'Bears' })).toBeTruthy();
    expect(screen.getByLabelText('Offered each reset')).toHaveProperty('max', '3');
    await userEvent.click(screen.getByRole('radio', { name: 'Daily' }));
    expect(await screen.findByText('Bears is not a daily quest.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true);
    await userEvent.click(screen.getByRole('button', { name: 'Make them all daily' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', false));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({ ...group, members: [q(60001), q(60002), q(60003)] }, [], 'daily');
  });
});
