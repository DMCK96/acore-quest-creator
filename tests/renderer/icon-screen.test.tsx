// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IconScreen } from '../../src/renderer/views/IconScreen';

describe('IconScreen', () => {
  it('shows the orb over the canvas background and nothing else', () => {
    const { container } = render(<IconScreen />);
    expect(container.querySelector('.icon-screen .quest-orb')).not.toBeNull();
    expect(container.querySelector('.icon-screen .react-flow__background')).not.toBeNull();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('heading')).toHaveLength(0);
    expect(container.textContent?.trim()).toBe('');
  });
});
