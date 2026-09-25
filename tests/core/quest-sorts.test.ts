import { describe, expect, it } from 'vitest';
import { QUEST_SORT_CATEGORIES, readQuestSorts } from '../../src/core/game/quest-sorts';
import { buildDbcWithStrings } from '../helpers/dbc';

const row = (n: number, cells: Record<number, number | string>) => Array.from({ length: n }, (_, i) => cells[i] ?? 0);

const maps = buildDbcWithStrings([row(66, { 0: 0, 5: 'Eastern Kingdoms' }), row(66, { 0: 36, 2: 1, 5: 'Deadmines' })], 66);
const areas = buildDbcWithStrings(
  [
    row(36, { 0: 12, 1: 0, 2: 0, 11: 'Elwynn Forest' }),
    row(36, { 0: 87, 1: 0, 2: 12, 11: 'Goldshire' }),
    row(36, { 0: 1581, 1: 36, 2: 0, 11: 'The Deadmines' }),
  ],
  36,
);
const sorts = buildDbcWithStrings([row(18, { 0: 81, 1: 'Warrior' }), row(18, { 0: 22, 1: 'Seasonal' })], 18);

describe('quest log headings', () => {
  const index = readQuestSorts({ areas, maps, sorts });

  it('finds zones by name with where they are, and categories as negative ids', () => {
    expect(index.search('elwynn', 10)).toEqual([{ id: 12, name: 'Elwynn Forest', detail: 'Zone in Eastern Kingdoms' }]);
    expect(index.search('dead', 10)).toEqual([{ id: 1581, name: 'The Deadmines', detail: 'Zone in Deadmines' }]);
    expect(index.search('warr', 10)).toEqual([{ id: -81, name: 'Warrior', detail: 'Category' }]);
  });

  it('offers only top-level zones, but names a subzone already stored', () => {
    expect(index.search('goldshire', 10)).toEqual([]);
    expect(index.get(87)).toBe('Goldshire');
  });

  it('finds by id: a plain number is a zone, a negative one a category', () => {
    expect(index.search('12', 10)).toEqual([{ id: 12, name: 'Elwynn Forest', detail: 'Zone in Eastern Kingdoms' }]);
    expect(index.search('-22', 10)).toEqual([{ id: -22, name: 'Seasonal', detail: 'Category' }]);
  });

  it('names both kinds of value', () => {
    expect(index.get(12)).toBe('Elwynn Forest');
    expect(index.get(-81)).toBe('Warrior');
    expect(index.get(-9999)).toBeUndefined();
  });

  it('without the server data folder, still knows the categories and shows zones by id', () => {
    const bare = readQuestSorts({});
    expect(bare.search('seasonal', 10)).toEqual([{ id: -22, name: 'Seasonal', detail: 'Category' }]);
    expect(bare.search('1519', 10)).toEqual([{ id: 1519, name: 'Zone 1519', detail: 'Zone' }]);
    expect(bare.get(1519)).toBe('Zone 1519');
    expect(bare.get(-81)).toBe(QUEST_SORT_CATEGORIES.find((c) => c.id === 81)?.name);
  });
});
