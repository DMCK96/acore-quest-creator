// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EventDialog } from '../../src/renderer/world3d/EventDialog';

const events = [{ id: 12, name: 'Darkmoon Faire' }, { id: 4, name: "Hallow's End" }];

describe('the event dialog', () => {
  it("starts from the spawns' shared setting and applies a rule with several events", async () => {
    const onApply = vi.fn();
    render(<EventDialog names={['Stormwind Guard']} initial="npc" events={events} onApply={onApply} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Game events' })).toBeTruthy();
    expect(screen.getByLabelText('Event')).toHaveProperty('value', 'npc');
    await userEvent.selectOptions(screen.getByLabelText('Event'), 'Gone during…');
    expect(screen.getByRole('button', { name: 'Apply' })).toHaveProperty('disabled', true);
    await userEvent.click(screen.getByRole('option', { name: 'Darkmoon Faire' }));
    await userEvent.click(screen.getByRole('option', { name: "Hallow's End" }));
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledWith({ mode: 'except', events: [4, 12] });
  });

  it('starts with nothing chosen for spawns that differ, and cannot apply until something is', async () => {
    render(<EventDialog names={['A', 'B']} initial="mixed" events={events} onApply={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('2 spawns')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Apply' })).toHaveProperty('disabled', true);
    await userEvent.selectOptions(screen.getByLabelText('Event'), 'Always');
    expect(screen.getByRole('button', { name: 'Apply' })).toHaveProperty('disabled', false);
  });
});
