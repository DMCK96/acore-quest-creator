import { describe, expect, it } from 'vitest';
import { insertionIndex, withoutPoint } from '../../src/renderer/world3d/scene/edit/route';

const square = [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 10, y: 10, z: 0 }];

describe('where a Shift-click puts a new route point', () => {
  it('on a leg: between that leg\'s ends', () => {
    expect(insertionIndex(square, { x: 5, y: 1 }, null)).toBe(1);
    expect(insertionIndex(square, { x: 11, y: 5 }, null)).toBe(2);
  });

  it('on the leg back to the first point: at the end', () => {
    expect(insertionIndex(square, { x: 5, y: 5.5 }, 0)).toBe(3);
  });

  it('away from every leg: after the selected point, or at the end', () => {
    expect(insertionIndex(square, { x: 30, y: 30 }, 0)).toBe(1);
    expect(insertionIndex(square, { x: 30, y: 30 }, null)).toBe(3);
  });
});

describe('deleting a route point', () => {
  it('removes it, but never below two points', () => {
    expect(withoutPoint(square, 1)).toEqual([square[0], square[2]]);
    expect(withoutPoint(square.slice(0, 2), 0)).toBeNull();
  });
});
