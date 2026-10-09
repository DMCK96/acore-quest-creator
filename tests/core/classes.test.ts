import { describe, expect, it } from 'vitest';
import { CLASSES, className } from '../../src/core/game/classes';

describe('player classes', () => {
  it('names the ten stock classes, in id order', () => {
    expect(CLASSES.map((c) => c.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 11]);
    expect(className(2)).toBe('Paladin');
    expect(className(8)).toBe('Mage');
  });
  it('calls any other class by its number', () => {
    expect(className(12)).toBe('Class 12');
    expect(className(10)).toBe('Class 10');
  });
});
