import { describe, it, expect } from 'vitest';
import {
  decodeScalar, encodeScalar, decodeList, encodeList, valueEquals, CodecError, ListOverflowError,
} from '@core/registry/codec';
import type { ListFieldDef } from '@core/registry/types';

const rewardItems: ListFieldDef = {
  shape: 'list', id: 'quest_template.RewardItems', table: 'quest_template', slots: 4,
  label: 'Reward items', help: '', group: 'rewards',
  members: [
    { name: 'item', columnTemplate: 'RewardItem{n}', type: { kind: 'idRef', target: 'item' }, label: 'Item' },
    { name: 'amount', columnTemplate: 'RewardAmount{n}', type: { kind: 'int', min: 0 }, label: 'Amount' },
  ],
};
const objectiveText: ListFieldDef = {
  shape: 'list', id: 'quest_template.ObjectiveText', table: 'quest_template', slots: 4,
  label: 'Objective text', help: '', group: 'objectives',
  members: [{ name: 'text', columnTemplate: 'ObjectiveText{n}', type: { kind: 'string' }, label: 'Text' }],
};
const row = (o: Record<string, string | null>) => o;

describe('scalar codec', () => {
  it('decodes and encodes integers strictly', () => {
    expect(decodeScalar({ kind: 'int' }, '12')).toBe(12);
    expect(decodeScalar({ kind: 'int' }, '-3')).toBe(-3);
    expect(() => decodeScalar({ kind: 'int' }, 'abc')).toThrow(CodecError);
    expect(() => decodeScalar({ kind: 'int' }, '1.5')).toThrow(CodecError);
    expect(() => decodeScalar({ kind: 'int' }, '')).toThrow(CodecError);
    expect(() => decodeScalar({ kind: 'int' }, '9007199254740993')).toThrow(CodecError);
    expect(encodeScalar({ kind: 'int' }, 12)).toBe('12');
    expect(() => encodeScalar({ kind: 'int' }, 1.5)).toThrow(CodecError);
    expect(() => encodeScalar({ kind: 'int', min: 0 }, -1)).toThrow(CodecError);
  });
  it('keeps unsigned values above 2^31', () => {
    expect(decodeScalar({ kind: 'int' }, '4294967295')).toBe(4294967295);
    expect(encodeScalar({ kind: 'int' }, 4294967295)).toBe('4294967295');
  });
  it('passes strings through byte-exactly, including NULL', () => {
    const nasty = "it's a \ test\r\n\t $B$N  ";
    expect(decodeScalar({ kind: 'text' }, nasty)).toBe(nasty);
    expect(encodeScalar({ kind: 'text' }, nasty)).toBe(nasty);
    expect(decodeScalar({ kind: 'string' }, null)).toBeNull();
    expect(encodeScalar({ kind: 'string' }, null)).toBeNull();
  });
  it('decodes floats and accepts unknown enum values', () => {
    expect(decodeScalar({ kind: 'float' }, '0.5')).toBe(0.5);
    expect(decodeScalar({ kind: 'float' }, '-0')).toBe(-0);
    expect(encodeScalar({ kind: 'enum', options: [{ value: 1, label: 'A' }] }, 99)).toBe('99');
  });
  it('splits creatureOrGo by sign', () => {
    const t = { kind: 'creatureOrGo' } as const;
    expect(decodeScalar(t, '567')).toEqual({ target: 'creature', id: 567 });
    expect(decodeScalar(t, '-1234')).toEqual({ target: 'gameobject', id: 1234 });
    expect(decodeScalar(t, '0')).toBeNull();
    expect(encodeScalar(t, { target: 'gameobject', id: 1234 })).toBe('-1234');
    expect(encodeScalar(t, null)).toBe('0');
    expect(() => encodeScalar(t, { target: 'gameobject', id: 0 })).toThrow(CodecError);
  });
});

describe('list codec', () => {
  it('compacts non-empty slots when decoding', () => {
    const r = row({ RewardItem1: '100', RewardAmount1: '2', RewardItem2: '0', RewardAmount2: '0',
      RewardItem3: '300', RewardAmount3: '1', RewardItem4: '0', RewardAmount4: '0' });
    expect(decodeList(rewardItems, r)).toEqual([{ item: 100, amount: 2 }, { item: 300, amount: 1 }]);
  });
  it('encodes into leading slots and zero-fills the rest', () => {
    expect(encodeList(rewardItems, [{ item: 100, amount: 2 }])).toEqual({
      RewardItem1: '100', RewardAmount1: '2', RewardItem2: '0', RewardAmount2: '0',
      RewardItem3: '0', RewardAmount3: '0', RewardItem4: '0', RewardAmount4: '0',
    });
  });
  it('blank-fills string members', () => {
    expect(encodeList(objectiveText, [{ text: 'Find it' }])).toEqual({
      ObjectiveText1: 'Find it', ObjectiveText2: '', ObjectiveText3: '', ObjectiveText4: '',
    });
  });
  it('rejects more entries than slots', () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ item: i + 1, amount: 1 }));
    expect(() => encodeList(rewardItems, five)).toThrow(ListOverflowError);
  });
});

describe('valueEquals', () => {
  it('is strict and deep', () => {
    expect(valueEquals([{ a: 1 }], [{ a: 1 }])).toBe(true);
    expect(valueEquals(1, '1')).toBe(false);
    expect(valueEquals(null, '')).toBe(false);
    expect(valueEquals({ target: 'creature', id: 1 }, { target: 'creature', id: 1 })).toBe(true);
  });
});
