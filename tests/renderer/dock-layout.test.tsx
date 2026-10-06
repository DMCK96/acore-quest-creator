// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DockLayout } from '../../src/renderer/views/dock/DockLayout';

const layout = (over: Partial<React.ComponentProps<typeof DockLayout>> = {}) =>
  render(<DockLayout open side="bottom" size={0.4} onSize={() => {}} main={<div data-testid="main" />} dock={<div data-testid="dock" />} {...over} />);

describe('DockLayout', () => {
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

  // Each step of a drag would write the preferences and redraw the whole app: only where it ends is kept
  it('follows a divider drag itself, and keeps the size once when it is let go', () => {
    const onSize = vi.fn();
    layout({ onSize });
    vi.spyOn(document.querySelector('.dock-layout')!, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 1000, height: 1000, left: 0, right: 1000, width: 1000 } as DOMRect);
    const divider = screen.getByRole('separator');
    fireEvent.pointerDown(divider, { pointerId: 1, clientY: 600 });
    fireEvent.pointerMove(divider, { pointerId: 1, clientY: 500 });
    fireEvent.pointerMove(divider, { pointerId: 1, clientY: 300 });
    expect(onSize).not.toHaveBeenCalled();
    expect((document.querySelector('.dock-layout__dock') as HTMLElement).style.flexBasis).toBe('70%');
    expect(divider.getAttribute('aria-valuenow')).toBe('70');
    fireEvent.pointerUp(divider, { pointerId: 1, clientY: 300 });
    expect(onSize).toHaveBeenCalledTimes(1);
    expect(onSize).toHaveBeenLastCalledWith(0.7);
    // A move after it is let go is no drag
    fireEvent.pointerMove(divider, { pointerId: 1, clientY: 100 });
    expect(onSize).toHaveBeenCalledTimes(1);
  });

  it('keeps a drag the window took the pointer from', () => {
    const onSize = vi.fn();
    layout({ onSize });
    vi.spyOn(document.querySelector('.dock-layout')!, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 1000, height: 1000, left: 0, right: 1000, width: 1000 } as DOMRect);
    const divider = screen.getByRole('separator');
    fireEvent.pointerDown(divider, { pointerId: 1, clientY: 600 });
    fireEvent.pointerMove(divider, { pointerId: 1, clientY: 500 });
    fireEvent(divider, new Event('lostpointercapture', { bubbles: true }));
    expect(onSize).toHaveBeenLastCalledWith(0.5);
  });
});
