import { describe, expect, it } from 'vitest';
import { chooseZ, floorCandidates } from '../../src/core/map/floors';

describe('floors', () => {
  it('adds the terrain ground unless a floor already covers it', () => {
    expect(floorCandidates({ floors: [98.12, 127.4], ground: 82.1 })).toEqual([82.1, 98.12, 127.4]);
    expect(floorCandidates({ floors: [82.18, 98.12], ground: 82.1 })).toEqual([82.18, 98.12]);
    expect(floorCandidates({ floors: [], ground: null })).toEqual([]);
  });
  it('keeps a dragged marker on the floor nearest where it was', () => {
    expect(chooseZ([82.18, 98.12, 127.4], 97)).toBe(98.12);
    expect(chooseZ([82.18, 98.12, 127.4], 0)).toBe(82.18);
    expect(chooseZ([10, 20], 15)).toBe(10);
  });
  it('puts a new marker on the lowest floor, and gives nothing without data', () => {
    expect(chooseZ([82.18, 98.12], null)).toBe(82.18);
    expect(chooseZ([], 50)).toBeNull();
  });
});
