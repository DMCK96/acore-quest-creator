import { describe, expect, it } from 'vitest';
import { formatCoin } from '../../src/core/format/coin';

describe('formatCoin', () => {
  it('writes gold, silver and copper, leaving out the zero parts', () => {
    expect(formatCoin(12050)).toBe('1g 20s 50c');
    expect(formatCoin(10000)).toBe('1g');
    expect(formatCoin(205)).toBe('2s 5c');
    expect(formatCoin(7)).toBe('7c');
    expect(formatCoin(1234567)).toBe('123g 45s 67c');
  });
  it('writes nothing to pay as free', () => {
    expect(formatCoin(0)).toBe('free');
  });
});
