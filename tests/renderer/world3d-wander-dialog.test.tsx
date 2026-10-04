// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WanderDialog } from '../../src/renderer/world3d/WanderDialog';

function open(initial = 5) {
  const props = { onPreview: vi.fn(), onApply: vi.fn(), onClose: vi.fn() };
  render(<WanderDialog name="Guard" initial={initial} {...props} />);
  return props;
}

describe('the wander distance dialog', () => {
  it('starts at the NPC’s distance, previews each value typed, and applies it', async () => {
    const { onPreview, onApply } = open();
    const field = screen.getByRole('spinbutton', { name: 'Yards' });
    expect(field).toHaveValue(5);
    await userEvent.clear(field);
    await userEvent.type(field, '12');
    expect(onPreview).toHaveBeenLastCalledWith(12);
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledWith(12);
  });

  it.each(['', '-1', '250', '2.5'])('will not apply %j', async (typed) => {
    const { onApply, onPreview } = open();
    const field = screen.getByRole('spinbutton', { name: 'Yards' });
    await userEvent.clear(field);
    onPreview.mockClear();
    if (typed) await userEvent.type(field, typed);
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(onPreview).not.toHaveBeenCalledWith(Number(typed));
    expect(onApply).not.toHaveBeenCalled();
  });

  it('Esc and Cancel close it', async () => {
    const { onClose } = open();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
