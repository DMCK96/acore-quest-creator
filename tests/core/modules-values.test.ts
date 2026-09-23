import { describe, it, expect } from 'vitest';
import { registry, fieldById } from '@core/registry';
import { createNewAggregate } from '@core/import/new-quest';
import { loadSchema } from '@core/schema/load';
import { isUnset, emptyValue } from '@core/modules/values';
import { addEntry, removeEntry, moveEntry } from '@core/modules/entries';
import { forkDb } from '../helpers/fixtures';

const HEADER_OR_HIDDEN = /(\.ID|\.VerifiedBuild|quest_mail_sender\.QuestId|quest_template\.QuestLevel)$/;

describe('isUnset', () => {
  it('treats every value of a brand new quest as unset, except the header and hidden fields', async () => {
    const schema = await loadSchema(forkDb(), registry.tables.map((t) => t.table));
    const a = createNewAggregate(schema, registry, 60001);
    const set = Object.entries(a.values).filter(([id, v]) => !isUnset(id, v)).map(([id]) => id);
    expect(set.filter((id) => !HEADER_OR_HIDDEN.test(id))).toEqual([]);
  });
  it('sees zero, empty text, null, empty lists and a zero target as unset', () => {
    expect(isUnset('quest_template.TimeAllowed', 0)).toBe(true);
    expect(isUnset('quest_template.LogDescription', '')).toBe(true);
    expect(isUnset('quest_template.LogDescription', null)).toBe(true);
    expect(isUnset('quest_template.RewardItems', [])).toBe(true);
    expect(isUnset('quest_template.RequiredNpcOrGo', [{ target: { target: 'creature', id: 0 }, count: 0 }])).toBe(false);
    expect(isUnset('x', undefined)).toBe(true);
  });
  it('sees a value as set once it differs', () => {
    expect(isUnset('quest_template.TimeAllowed', 900)).toBe(false);
    expect(isUnset('quest_template.RewardItems', [{ item: 25, amount: 1 }])).toBe(false);
  });
  it('treats QuestType 2 (the new-quest default) as unset but any other type as set', () => {
    expect(isUnset('quest_template.QuestType', 2)).toBe(true);
    expect(isUnset('quest_template.QuestType', 0)).toBe(false);
  });
});

describe('emptyValue', () => {
  it('gives the empty value for each field shape', () => {
    expect(emptyValue(fieldById('quest_template.TimeAllowed')!)).toBe(0);
    expect(emptyValue(fieldById('quest_template.LogDescription')!)).toBe('');
    expect(emptyValue(fieldById('quest_template.RewardItems')!)).toEqual([]);
    expect(emptyValue(fieldById('creature_queststarter')!)).toEqual([]);
    expect(emptyValue(fieldById('quest_template.QuestType')!)).toBe(2);
  });
});

describe('entry lists', () => {
  it('adds up to the maximum and no further', () => {
    expect(addEntry([1, 2], 3, 3)).toEqual([1, 2, 3]);
    expect(addEntry([1, 2, 3], 4, 3)).toEqual([1, 2, 3]);
  });
  it('removes by index and ignores an index out of range', () => {
    expect(removeEntry(['a', 'b', 'c'], 1)).toEqual(['a', 'c']);
    expect(removeEntry(['a'], 5)).toEqual(['a']);
  });
  it('moves an entry and clamps the target', () => {
    expect(moveEntry(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveEntry(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveEntry(['a', 'b'], 1, 9)).toEqual(['a', 'b']);
  });
  it('never mutates its input', () => {
    const list = Object.freeze([1, 2]);
    addEntry(list, 3, 5);
    removeEntry(list, 0);
    moveEntry(list, 0, 1);
    expect(list).toEqual([1, 2]);
  });
});
