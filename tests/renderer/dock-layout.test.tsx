// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DockLayout, clampSize } from '../../src/renderer/views/dock/DockLayout';

const layout = (over: Partial<React.ComponentProps<typeof DockLayout>> = {}) =>
  render(<DockLayout open side="bottom" size={0.4} onSize={() => {}} main={<div data-testid="main" />} dock={<div data-testid="dock" />} {...over} />);

describe('DockLayout', () => {
  it('clamps sizes', () => {
    expect(clampSize(0)).toBe(0.15);
    expect(clampSize(2)).toBe(0.85);
    expect(clampSize(0.5)).toBe(0.5);
  });

  it('shows main and dock when open, only main when closed, main mounted either way', () => {
    const { rerender } = layout();
    const main = screen.getByTestId('main');
    expect(screen.getByTestId('dock')).toBeTruthy();
    rerender(<DockLayout open={false} side="bottom" size={0.4} onSize={() => {}} main={<div data-testid="main" />} dock={<div data-testid="dock" />} />);
    expect(screen.queryByTestId('dock')).toBeNull();
    expect(screen.getByTestId('main')).toBe(main);
  });

  it('keeps main mounted, the same node, when the side changes', () => {
    const { rerender } = layout();
    const main = screen.getByTestId('main');
    rerender(<DockLayout open side="right" size={0.4} onSize={() => {}} main={<div data-testid="main" />} dock={<div data-testid="dock" />} />);
    expect(screen.getByTestId('main')).toBe(main);
  });

  it('marks its orientation', () => {
    layout({ side: 'right' });
    expect(document.querySelector('.dock-layout')!.getAttribute('data-side')).toBe('right');
  });

  it('resizes with the keyboard on the divider', () => {
    const onSize = vi.fn();
    layout({ onSize });
    const divider = screen.getByRole('separator');
    fireEvent.keyDown(divider, { key: 'ArrowUp' });
    expect(onSize).toHaveBeenLastCalledWith(0.45);
    fireEvent.keyDown(divider, { key: 'ArrowDown' });
    expect(onSize).toHaveBeenLastCalledWith(0.35);
  });
});
