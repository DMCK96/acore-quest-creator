// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PositionInput } from '../../src/renderer/scripts/PositionInput';
import { NamesProvider } from '../../src/renderer/state/names';
import { makeMockApi, okv } from './mock-api';

const mount = (groundHeight: (...a: any[]) => any, onChange = vi.fn()) => {
  render(
    <NamesProvider api={makeMockApi({ groundHeight })}>
      <PositionInput idPrefix="p" map={0} value={{ x: 1, y: 2, z: 0, o: 0 }} onChange={onChange} />
    </NamesProvider>,
  );
  return onChange;
};

describe('Snap to ground', () => {
  it('sets Z from the ground height', async () => {
    const onChange = mount(async () => okv({ z: 80.46 }));
    await userEvent.click(screen.getByRole('button', { name: 'Snap to ground' }));
    expect(onChange).toHaveBeenCalledWith({ x: 1, y: 2, z: 80.46, o: 0 });
  });
  it('shows why there is no height', async () => {
    const onChange = mount(async () => okv({ reason: 'No map file covers this point (0000000.map).' }));
    await userEvent.click(screen.getByRole('button', { name: 'Snap to ground' }));
    expect(await screen.findByText(/No map file covers this point/)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
  it('offers no button without a map', () => {
    render(<PositionInput idPrefix="p" value={{ x: 1, y: 2, z: 0, o: 0 }} onChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Snap to ground' })).toBeNull();
  });
});
