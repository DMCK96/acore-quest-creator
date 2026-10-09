import { describe, expect, it } from 'vitest';
import { buildExtendedCostIndex, extendedCostLabel, readExtendedCosts } from '../../src/core/game/extended-costs';
import { buildDbc, costRecord } from '../helpers/dbc';
const names = new Map([[20559, 'Mark of Honor']]);
const name = (id: number) => names.get(id);

describe('item extended costs', () => {
  const costs = readExtendedCosts(buildDbc([costRecord(1, 2000, 0, [[20559, 1]]), costRecord(2, 0, 1500, [], 1700), costRecord(3, 0, 0, [])]));

  it('reads each record', () => {
    expect(costs.get(1)).toEqual({ id: 1, honor: 2000, arena: 0, rating: 0, items: [{ item: 20559, count: 1 }] });
    expect(costs.get(2)).toMatchObject({ arena: 1500, rating: 1700, items: [] });
  });
  it('rejects a file with too few fields', () => {
    expect(() => readExtendedCosts(buildDbc([[1, 0, 0, 0, 0, 0, 0, 0, 0, 0]]))).toThrow(/10 fields/);
  });
  it('names the 16 fields a 3.3.5a file has when it is too short', () => {
    expect(() => readExtendedCosts(buildDbc([[1, 0, 0, 0, 0, 0, 0, 0, 0, 0]]))).toThrow(/has 16/);
  });
  it('labels a cost readably', () => {
    expect(extendedCostLabel(costs.get(1)!, name)).toBe('2000 honor + 1 Mark of Honor');
    expect(extendedCostLabel(costs.get(2)!, name)).toBe('1500 arena points (rating 1700)');
    expect(extendedCostLabel(costs.get(3)!, name)).toBe('No cost');
    expect(extendedCostLabel({ id: 9, honor: 0, arena: 0, rating: 0, items: [{ item: 5, count: 3 }] }, () => undefined)).toBe('3 item 5');
  });
  it('searches by id or by label', () => {
    const index = buildExtendedCostIndex(costs, name);
    expect(index.get(1)).toBe('2000 honor + 1 Mark of Honor');
    expect(index.get(99)).toBeUndefined();
    expect(index.search('2', 10)).toEqual([{ id: 2, name: '1500 arena points (rating 1700)' }]);
    expect(index.search('mark', 10)).toEqual([{ id: 1, name: '2000 honor + 1 Mark of Honor' }]);
    expect(index.search('', 10)).toEqual([]);
  });
  it('lists labels that start with the text before ones that only contain it, and honours the limit', () => {
    const many = readExtendedCosts(buildDbc([costRecord(1, 11, 0, []), costRecord(2, 1, 0, []), costRecord(3, 21, 0, [])]));
    const index = buildExtendedCostIndex(many, name);
    expect(index.search('1 h', 10).map((h) => h.id)).toEqual([2, 1, 3]);
    expect(index.search('1 h', 2).map((h) => h.id)).toEqual([2, 1]);
  });
});
