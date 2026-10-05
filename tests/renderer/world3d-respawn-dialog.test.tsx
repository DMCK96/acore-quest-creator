// tests/renderer/world3d-respawn-dialog.test.tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RespawnDialog } from '../../src/renderer/world3d/RespawnDialog';

describe('the respawn dialog', () => {
  it('starts from the spawn\'s time in minutes and seconds and applies the new one in seconds', async () => {
    const onApply = vi.fn();
    render(<RespawnDialog names={['Stormwind Guard']} initial={330} onApply={onApply} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Respawn time' })).toBeTruthy();
    expect(screen.getByText('Stormwind Guard')).toBeTruthy();
    expect(screen.getByLabelText('Minutes')).toHaveProperty('value', '5');
    expect(screen.getByLabelText('Seconds')).toHaveProperty('value', '30');
    await userEvent.clear(screen.getByLabelText('Minutes'));
    await userEvent.type(screen.getByLabelText('Minutes'), '45');
    await userEvent.clear(screen.getByLabelText('Seconds'));
    await userEvent.type(screen.getByLabelText('Seconds'), '0');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledWith(2700);
  });

  it('starts blank for spawns with different times and cannot apply until one is typed', async () => {
    render(<RespawnDialog names={['A', 'B']} initial={null} onApply={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('2 spawns')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Apply' })).toHaveProperty('disabled', true);
    await userEvent.type(screen.getByLabelText('Seconds'), '90');
    expect(screen.getByRole('button', { name: 'Apply' })).toHaveProperty('disabled', false);
  });
});
