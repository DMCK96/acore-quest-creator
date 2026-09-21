import { describe, it, expect } from 'vitest';
import { nextNodePosition } from '@core/canvas/layout';

describe('nextNodePosition', () => {
  it('starts at the origin and fills a row of four before starting the next', () => {
    expect(nextNodePosition([])).toEqual({ x: 0, y: 0 });
    expect(nextNodePosition([{ x: 0, y: 0 }])).toEqual({ x: 320, y: 0 });
    const row = [0, 320, 640, 960].map((x) => ({ x, y: 0 }));
    expect(nextNodePosition(row)).toEqual({ x: 0, y: 180 });
  });
  it('treats a node dragged near a slot as occupying it, but not one that only sits close by', () => {
    expect(nextNodePosition([{ x: 100, y: 60 }])).toEqual({ x: 640, y: 0 }); // blocks both neighbouring slots
    expect(nextNodePosition([{ x: 10, y: 10 }])).toEqual({ x: 320, y: 0 });
    expect(nextNodePosition([{ x: 2000, y: 2000 }])).toEqual({ x: 0, y: 0 });
  });
  it('skips gaps left by removed nodes', () => {
    expect(nextNodePosition([{ x: 320, y: 0 }])).toEqual({ x: 0, y: 0 });
  });
});
