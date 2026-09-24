import { describe, expect, it } from 'vitest';
import { readSpellIndex, spellDetail, spellLabel } from '../../src/core/game/spells';
import { DbcFormatError } from '../../src/core/game/dbc';
import { buildDbc, buildDbcWithStrings, f32 } from '../helpers/dbc';

interface S { id: number; name: string; rank?: string; cast?: number; recovery?: number; category?: number; range?: number; school?: number; a?: number[]; b?: number[]; attributes?: number }
const record = (s: S): (number | string)[] => {
  const r: (number | string)[] = Array(234).fill(0);
  r[0] = s.id; r[4] = s.attributes ?? 0; r[28] = s.cast ?? 0; r[29] = s.recovery ?? 0; r[30] = s.category ?? 0; r[46] = s.range ?? 0;
  (s.a ?? [0, 0, 0]).forEach((v, i) => (r[86 + i] = v));
  (s.b ?? [0, 0, 0]).forEach((v, i) => (r[89 + i] = v));
  r[136] = s.name; r[153] = s.rank ?? ''; r[225] = s.school ?? 0;
  return r;
};
const spellFile = (spells: S[]) => buildDbcWithStrings(spells.map(record), 234);
const castTimes = buildDbc([[1, 0, 0, 0], [15, 1300, 0, 1300]]);
const ranges = buildDbc([[1, 0, 0, 0, 0, 0, ...Array(34).fill(0)], [4, 0, 0, f32(30), f32(30), 0, ...Array(34).fill(0)]], 40);

const SPELLS: S[] = [
  { id: 116, name: 'Frostbolt', rank: 'Rank 1', cast: 15, range: 4, school: 16, a: [6, 6, 6] },
  { id: 122, name: 'Frost Nova', rank: 'Rank 1', cast: 1, category: 20000, range: 1, school: 16, a: [22, 22, 0], b: [15, 15, 0] },
  { id: 2139, name: 'Counterspell', cast: 1, recovery: 24000, category: 24000, range: 4, school: 64, a: [6, 0, 0] },
  { id: 6788, name: 'Weakened Soul', school: 2, a: [25, 0, 0], attributes: 0x24000000 },
  { id: 8269, name: 'Frenzy', cast: 1, school: 1, a: [1, 1, 1] },
  { id: 9000, name: 'Odd', school: 20, a: [25, 0, 0] },
  { id: 9001, name: 'Frostbolt Volley', school: 16, a: [6, 0, 0] },
  { id: 8, name: 'Frostbolt', rank: 'Rank 2', school: 16, a: [6, 0, 0] },
];
const index = (overrides?: Record<string, string | null>[]) => readSpellIndex({ spell: spellFile(SPELLS), castTimes, ranges, overrides });

describe('spell index', () => {
  it('reads the facts the picker shows', () => {
    expect(index().get(116)).toEqual({ id: 116, name: 'Frostbolt', rank: 'Rank 1', castMs: 1300, cooldownMs: 0, rangeYd: 30, school: 'Frost', kind: 'harmful' });
    expect(index().get(2139)).toMatchObject({ castMs: 0, cooldownMs: 24000, school: 'Arcane' });
    expect(index().size).toBe(8);
  });
  it('tells harmful from helpful spells', () => {
    const i = index();
    expect([122, 6788, 8269, 9000].map((id) => i.get(id)!.kind)).toEqual(['harmful', 'harmful', 'helpful', 'unknown']);
    expect(i.get(9000)!.school).toBe('Fire/Frost');
  });
  it('works without the cast time and range files', () => {
    const i = readSpellIndex({ spell: spellFile(SPELLS), castTimes: null, ranges: null });
    expect(i.get(116)).toMatchObject({ castMs: null, rangeYd: null });
  });
  it('rejects a file that is not 3.3.5a Spell.dbc', () => {
    expect(() => readSpellIndex({ spell: buildDbc([[1, 2, 3]]), castTimes: null, ranges: null })).toThrow(DbcFormatError);
  });
  it('searches by name, exact then prefix then substring, ties by id', () => {
    expect(index().search('frostbolt', 10).map((s) => s.id)).toEqual([8, 116, 9001]);
    expect(index().search('  FROST ', 10).map((s) => s.id)).toEqual([8, 116, 122, 9001]);
    expect(index().search('nova', 10).map((s) => s.id)).toEqual([122]);
    expect(index().search('frost', 2).map((s) => s.id)).toEqual([8, 116]);
    expect(index().search('', 10)).toEqual([]);
  });
  it('searches by id', () => {
    expect(index().search('116', 10).map((s) => s.id)).toEqual([116]);
  });
  it('lets spell_dbc rows add and replace spells, as the server does', () => {
    const i = index([
      { ID: '90001', Name_Lang_enUS: 'Custom Bolt', NameSubtext_Lang_enUS: '', CastingTimeIndex: '15', RecoveryTime: '0', CategoryRecoveryTime: '0', RangeIndex: '4', SchoolMask: '4', ImplicitTargetA_1: '6', ImplicitTargetB_1: '0', Attributes: '0' },
      { ID: '116', Name_Lang_enUS: 'Chillbolt', NameSubtext_Lang_enUS: null, CastingTimeIndex: '1', RecoveryTime: '0', CategoryRecoveryTime: '0', RangeIndex: '1', SchoolMask: '16', ImplicitTargetA_1: '6', ImplicitTargetB_1: '0', Attributes: '0' },
    ]);
    expect(i.get(90001)).toEqual({ id: 90001, name: 'Custom Bolt', rank: '', castMs: 1300, cooldownMs: 0, rangeYd: 30, school: 'Fire', kind: 'harmful' });
    expect(i.get(116)!.name).toBe('Chillbolt');
    expect(i.search('chill', 5).map((s) => s.id)).toEqual([116]);
  });
  it('writes the detail line and the label', () => {
    const i = index();
    expect(spellDetail(i.get(116)!)).toBe('Rank 1 · 1.3 s cast · 30 yd · Frost · harmful');
    expect(spellDetail(i.get(2139)!)).toBe('instant · 24 s cooldown · 30 yd · Arcane · harmful');
    expect(spellDetail(i.get(9000)!)).toBe('Fire/Frost');
    expect(spellLabel(i.get(116)!)).toBe('Frostbolt (Rank 1)');
    expect(spellLabel(i.get(2139)!)).toBe('Counterspell');
  });
});
