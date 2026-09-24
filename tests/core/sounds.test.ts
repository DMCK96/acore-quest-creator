// tests/core/sounds.test.ts
import { describe, expect, it } from 'vitest';
import { readSoundIndex } from '../../src/core/game/sounds';
import { buildDbcWithStrings } from '../helpers/dbc';

const row = (id: number, name: string) => { const r: (number | string)[] = Array(30).fill(0); r[0] = id; r[2] = name; return r; };
const index = () => readSoundIndex(buildDbcWithStrings([row(3, 'BellTollHuman'), row(12, 'GuardAlarm'), row(1201, 'HornOfWar'), row(40, 'Bell Tower')], 30));

describe('sound names', () => {
  it('names a sound by id', () => {
    expect(index().get(12)).toBe('GuardAlarm');
    expect(index().get(99)).toBeUndefined();
  });
  it('finds sounds by id first, then names that start with the text, then names that contain it', () => {
    expect(index().search('12', 10).map((s) => s.id)).toEqual([12]);
    expect(index().search('bell', 10).map((s) => s.id)).toEqual([3, 40]);
    expect(index().search('war', 10).map((s) => s.id)).toEqual([1201]);
    expect(index().search('', 10)).toEqual([]);
    expect(index().search('bell', 1)).toHaveLength(1);
  });
});
