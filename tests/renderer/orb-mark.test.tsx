// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { OrbMark } from '../../src/renderer/components/OrbMark';

describe('the orb mark', () => {
  it('is decoration the login orb can fly into, at the size asked for', () => {
    const { container } = render(<OrbMark size={40} />);
    const mark = container.querySelector('.orb-mark') as HTMLElement;
    expect(mark).toHaveAttribute('aria-hidden', 'true');
    expect(mark).toHaveAttribute('data-orb-target');
    expect(mark.style.width).toBe('40px');
    expect(mark.style.height).toBe('40px');
    expect(mark).not.toHaveClass('orb-mark--spinning');
  });

  it('is 28 px by default, and can spin while something loads', () => {
    const { container } = render(<OrbMark spinning />);
    const mark = container.querySelector('.orb-mark') as HTMLElement;
    expect(mark.style.width).toBe('28px');
    expect(mark).toHaveClass('orb-mark--spinning');
  });
});
