import { describe, expect, it } from 'vitest';
import { COMMON_FACTIONS, reactionOf, readFactionTemplates } from '../../src/core/game/faction-templates';
import { buildDbc, buildDbcWithStrings } from '../helpers/dbc';

/** Rows of numbers only, for `buildDbc`. */
const nums = (rows: (number | string)[][]): number[][] => rows as number[][];
const row = (n: number, set: Record<number, number | string>) => { const r: (number | string)[] = Array(n).fill(0); for (const [k, v] of Object.entries(set)) r[Number(k)] = v; return r; };
const index = () => readFactionTemplates({
  templates: buildDbc(nums([row(14, { 0: 11, 1: 72, 3: 3, 4: 2, 5: 12 }), row(14, { 0: 14, 1: 14, 3: 8, 4: 0, 5: 1 }), row(14, { 0: 35, 1: 35, 3: 0, 4: 0, 5: 0 })]), 14),
  factions: buildDbcWithStrings([row(57, { 0: 72, 23: 'Stormwind' }), row(57, { 0: 14, 23: 'Monster' }), row(57, { 0: 35, 23: 'Friendly' })], 57),
});

describe('faction templates', () => {
  it('lists the common factions first-class', () => {
    expect(COMMON_FACTIONS.map((f) => [f.id, f.label])).toEqual([[35, 'Friendly to all'], [14, 'Hostile to all'], [11, 'Stormwind'], [85, 'Orgrimmar'], [7, 'Monster']]);
  });
  it('says in words who a template is friendly and hostile to', () => {
    expect(reactionOf({ friendly: 2, hostile: 12 })).toBe('friendly to Alliance; hostile to Horde and monsters');
    expect(reactionOf({ friendly: 0, hostile: 1 })).toBe('hostile to players');
    expect(reactionOf({ friendly: 0, hostile: 0 })).toBe('neutral');
  });
  it('names templates by their faction and finds them by name or id', () => {
    expect(index().get(11)).toEqual({ name: 'Stormwind', detail: 'friendly to Alliance; hostile to Horde and monsters' });
    expect(index().search('storm', 5).map((f) => f.id)).toEqual([11]);
    expect(index().search('35', 5).map((f) => f.id)).toEqual([35]);
  });
});
