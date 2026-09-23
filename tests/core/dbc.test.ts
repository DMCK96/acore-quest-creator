import { describe, expect, it } from 'vitest';
import { DbcFormatError, parseDbc, parseQuestXp } from '../../src/core/game/dbc';
import { buildDbc, questXpDbc } from '../helpers/dbc';

describe('parseDbc', () => {
  it('reads each record as uint32 fields', () => {
    expect(parseDbc(buildDbc([[1, 2, 3], [4, 5, 4294967295]]))).toEqual({ fieldCount: 3, records: [[1, 2, 3], [4, 5, 4294967295]] });
  });
  it('refuses a file that is not WDBC or does not match its header', () => {
    const good = buildDbc([[1, 2]]);
    const wrongMagic = good.slice();
    wrongMagic[0] = 0x58;
    expect(() => parseDbc(wrongMagic)).toThrow(DbcFormatError);
    expect(() => parseDbc(good.slice(0, good.length - 1))).toThrow(/does not match its header/);
    expect(() => parseDbc(new Uint8Array(4))).toThrow(/too short/);
  });
});

describe('parseQuestXp', () => {
  it('maps each level to the XP of tiers 0-9', () => {
    const xp = parseQuestXp(questXpDbc([1, 26]));
    expect(xp.get(26)).toEqual([0, 2600, 5200, 7800, 10400, 13000, 15600, 18200, 20800, 23400]);
    expect(xp.has(2)).toBe(false);
  });
  it('refuses a file with too few fields', () => {
    expect(() => parseQuestXp(buildDbc([[1, 2, 3]]))).toThrow(/has 3 fields/);
  });
});
