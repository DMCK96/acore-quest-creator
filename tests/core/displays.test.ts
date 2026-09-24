import { describe, expect, it } from 'vitest';
import { modelName, readCreatureDisplays, readObjectDisplays } from '../../src/core/game/displays';
import { buildDbc, buildDbcWithStrings } from '../helpers/dbc';

/** Rows of numbers only, for `buildDbc`. */
const nums = (rows: (number | string)[][]): number[][] => rows as number[][];
const row = (n: number, set: Record<number, number | string>) => { const r: (number | string)[] = Array(n).fill(0); for (const [k, v] of Object.entries(set)) r[Number(k)] = v; return r; };
const displays = buildDbc(nums([row(16, { 0: 2, 1: 1, 3: 0 }), row(16, { 0: 3167, 1: 49, 3: 23 }), row(16, { 0: 3168, 1: 49, 3: 30 })]), 16);
const models = buildDbcWithStrings([row(28, { 0: 1, 2: 'Creature\\Basilisk\\Basilisk.mdx' }), row(28, { 0: 49, 2: 'Character\\Human\\Male\\HumanMale.mdx' })], 28);
const extras = buildDbc(nums([row(21, { 0: 23, 1: 1, 2: 0, 11: 6080 }), row(21, { 0: 30, 1: 1, 2: 1, 10: 254 })]), 21);
const races = buildDbcWithStrings([row(69, { 0: 1, 14: 'Human' })], 69);
const creatures = () => readCreatureDisplays({ displays, models, extras, races });

describe('display indexes', () => {
  it('names a model from its path', () => {
    expect(modelName('World\\Generic\\ActiveDoodads\\Chest02\\Chest02.mdx')).toBe('Chest02');
  });
  it('names creature displays by race, sex and armour, or by model', () => {
    expect(creatures().get(2)).toBe('Basilisk');
    expect(creatures().get(3167)).toBe('Human male · armoured');
    expect(creatures().get(3168)).toBe('Human female');
    expect(creatures().get(9)).toBeUndefined();
  });
  it('finds displays by id or by every word typed', () => {
    expect(creatures().search('3167', 10).map((d) => d.id)).toEqual([3167]);
    expect(creatures().search('human female', 10).map((d) => d.id)).toEqual([3168]);
    expect(creatures().search('human', 10).map((d) => d.id)).toEqual([3167, 3168]);
    expect(creatures().search('human', 1)).toHaveLength(1);
    expect(creatures().search(' ', 10)).toEqual([]);
  });
  it('names object displays by model file', () => {
    const objects = readObjectDisplays(buildDbcWithStrings([row(19, { 0: 1, 1: 'World\\Generic\\ActiveDoodads\\Chest02\\Chest02.mdx' })], 19));
    expect(objects.get(1)).toBe('Chest02');
    expect(objects.search('chest', 5)).toEqual([{ id: 1, name: 'Chest02' }]);
  });
});
