import { describe, expect, it } from 'vitest';
import { compassOf, normaliseOrientation, orientationToward } from '../../src/core/lore/facing';

const TAU = Math.PI * 2;

describe('compassOf', () => {
  it.each([
    [0, 'N'], [Math.PI / 4, 'NW'], [Math.PI / 2, 'W'], [(3 * Math.PI) / 4, 'SW'],
    [Math.PI, 'S'], [(5 * Math.PI) / 4, 'SE'], [(3 * Math.PI) / 2, 'E'], [(7 * Math.PI) / 4, 'NE'],
  ] as const)('reads %f as %s', (orientation, word) => {
    expect(compassOf(orientation)).toBe(word);
  });

  it('wraps: just under 2π and just over 0 are both north, and negatives and big values normalise', () => {
    expect(compassOf(TAU - 0.01)).toBe('N');
    expect(compassOf(0.01)).toBe('N');
    expect(compassOf(-Math.PI / 2)).toBe('E');
    expect(compassOf(TAU + Math.PI)).toBe('S');
  });

  it('rounds to the nearest sector', () => {
    expect(compassOf(1.5)).toBe('W'); // 1.5 rad is just under π/2
    expect(compassOf(0.3)).toBe('N'); // under π/8 = 0.3927
    expect(compassOf(0.4)).toBe('NW');
  });
});

describe('normaliseOrientation', () => {
  it('maps into 0 up to but not including 2π', () => {
    expect(normaliseOrientation(0)).toBe(0);
    expect(normaliseOrientation(-1)).toBeCloseTo(TAU - 1, 10);
    expect(normaliseOrientation(TAU)).toBe(0);
    expect(normaliseOrientation(TAU + 1)).toBeCloseTo(1, 10);
  });
});

describe('orientationToward', () => {
  it('faces due north, west, south and east in this world (X north, Y west)', () => {
    const from = { x: 100, y: 100 };
    expect(orientationToward(from, { x: 110, y: 100 })).toBeCloseTo(0, 10);
    expect(orientationToward(from, { x: 100, y: 110 })).toBeCloseTo(Math.PI / 2, 10);
    expect(orientationToward(from, { x: 90, y: 100 })).toBeCloseTo(Math.PI, 10);
    expect(orientationToward(from, { x: 100, y: 90 })).toBeCloseTo((3 * Math.PI) / 2, 10);
  });

  it('agrees with compassOf', () => {
    expect(compassOf(orientationToward({ x: 0, y: 0 }, { x: -5, y: -5 }))).toBe('SE');
  });
});
