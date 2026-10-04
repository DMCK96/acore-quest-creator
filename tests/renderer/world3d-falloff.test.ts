import { describe, expect, it } from 'vitest';
import { FALLOFF_DEFAULT, falloffWeight, falloffWeights, stepRadius } from '../../src/renderer/world3d/scene/edit/falloff';

describe('falloff', () => {
  it('is 1 at a selected point, 0 at the radius and beyond, a half half-way, and falls smoothly', () => {
    expect(falloffWeight(0, 10)).toBe(1);
    expect(falloffWeight(5, 10)).toBeCloseTo(0.5, 9);
    expect(falloffWeight(10, 10)).toBe(0);
    expect(falloffWeight(25, 10)).toBe(0);
    // Smooth at both ends: barely changes near a selected point and near the radius
    expect(falloffWeight(0.5, 10)).toBeGreaterThan(0.99);
    expect(falloffWeight(9.5, 10)).toBeLessThan(0.01);
  });

  it('measures across the ground to the nearest selected point and leaves out points it does not reach', () => {
    const weights = falloffWeights([{ x: 0, y: 0 }, { x: 100, y: 0 }], [{ key: 'a', x: 5, y: 0 }, { key: 'b', x: 97, y: 0 }, { key: 'c', x: 50, y: 0 }], 10);
    expect(weights.get('a')).toBeCloseTo(0.5, 9);
    expect(weights.get('b')).toBeCloseTo(falloffWeight(3, 10), 9);
    expect(weights.has('c')).toBe(false);
  });

  it('starts at 10 yards and steps by a tenth, kept between 1 and 200', () => {
    expect(FALLOFF_DEFAULT).toBe(10);
    expect(stepRadius(10, 1)).toBeCloseTo(11, 9);
    expect(stepRadius(10, -1)).toBeCloseTo(9, 9);
    expect(stepRadius(195, 1)).toBe(200);
    expect(stepRadius(1.05, -1)).toBe(1);
  });
});
