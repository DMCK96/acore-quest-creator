import { describe, it, expect } from 'vitest';
import { FakeWorldDb } from '../helpers/fake-world-db';
import {
  allocateQuestId, collectTakenIds, assertIdFree, validateRange, rangeOverlapsBlizzlike,
  RangeExhaustedError, IdCollisionError, InvalidRangeError,
} from '@core/ids/allocator';

describe('allocateQuestId', () => {
  it('returns the lowest free id', () => {
    expect(allocateQuestId({ start: 60000, end: 60005 }, new Set())).toBe(60000);
    expect(allocateQuestId({ start: 60000, end: 60005 }, new Set([60000, 60001, 60003]))).toBe(60002);
  });
  it('throws a named error when the range is full', () => {
    expect(() => allocateQuestId({ start: 1, end: 2 }, new Set([1, 2]))).toThrow(RangeExhaustedError);
  });
  it('ignores taken ids outside the range', () => {
    expect(allocateQuestId({ start: 10, end: 12 }, new Set([1, 2, 3]))).toBe(10);
  });
});

describe('validateRange', () => {
  it('rejects reversed, non-positive and non-integer ranges', () => {
    for (const r of [{ start: 5, end: 4 }, { start: 0, end: 10 }, { start: -1, end: 10 }, { start: 1.5, end: 10 }, { start: 1, end: Number.NaN }]) {
      expect(() => validateRange(r)).toThrow(InvalidRangeError);
    }
    expect(() => validateRange({ start: 60000, end: 99999 })).not.toThrow();
  });
  it('flags ranges overlapping Blizzlike ids', () => {
    expect(rangeOverlapsBlizzlike({ start: 20000, end: 70000 })).toBe(true);
    expect(rangeOverlapsBlizzlike({ start: 60000, end: 99999 })).toBe(false);
  });
});

describe('world DB checks', () => {
  const db = () => {
    const d = FakeWorldDb.fromFork(['quest_template']);
    d.insert('quest_template', { ID: '60000' });
    d.insert('quest_template', { ID: '60002' });
    return d;
  };
  it('unions world ids in range with draft ids', async () => {
    const taken = await collectTakenIds(db(), { start: 60000, end: 60010 }, [60001, 70000]);
    expect([...taken].sort()).toEqual([60000, 60001, 60002, 70000].sort());
    expect(allocateQuestId({ start: 60000, end: 60010 }, taken)).toBe(60003);
  });
  it('detects a collision that appeared after assignment', async () => {
    await expect(assertIdFree(db(), 60002)).rejects.toBeInstanceOf(IdCollisionError);
    await expect(assertIdFree(db(), 60003)).resolves.toBeUndefined();
  });
});
