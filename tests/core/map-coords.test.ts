import { describe, expect, it } from 'vitest';
import { gridOf } from '../../src/core/map/coords';

describe('map coordinates', () => {
  it('finds the grid the server uses', () => {
    expect(gridOf(-8902.59, -162.606)).toEqual({ gx: 48, gy: 32 });
    expect(gridOf(-1, -1)).toEqual({ gx: 32, gy: 32 });
  });
});
