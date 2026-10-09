import { describe, expect, it } from 'vitest';
import { entityIssues } from '../../src/core/entities/validate';
import { newNpc, newSpawn, type CustomNpc, type VendorItem } from '../../src/core/entities/model';

const stock = (item: number, extendedCost = 0): VendorItem => ({ item, maxCount: 0, restockSecs: 0, extendedCost });
const npc = (vendor: VendorItem[]): CustomNpc => ({ ...newNpc(12000001), name: 'Hela', displayId: 1, spawns: [{ ...newSpawn(1), x: 1 }], vendor });
const issues = (vendor: VendorItem[], known: ((id: number) => boolean) | null = null) =>
  entityIssues({ entities: { npcs: [npc(vendor)], objects: [], items: [] }, dbNames: new Map(), knownItem: known });
const codes = (list: ReturnType<typeof issues>) => list.map((i) => `${i.severity}:${i.code}`);

describe('vendor stock checks', () => {
  it('accepts a clean list', () => {
    expect(issues([stock(159), stock(159, 77)], () => true)).toEqual([]);
  });
  it('errors on a row with no item', () => {
    expect(codes(issues([stock(0)]))).toEqual(['error:VENDOR_NO_ITEM']);
  });
  it('errors once per repeated item and extended cost pair', () => {
    expect(codes(issues([stock(5), stock(6), stock(5), stock(5)]))).toEqual(['error:VENDOR_DUPLICATE']);
    expect(issues([stock(5), stock(5)])[0]!.message).toContain('item 5');
  });
  it('warns about an item nothing has, only when it can tell', () => {
    expect(codes(issues([stock(999)], (id) => id !== 999))).toEqual(['warning:VENDOR_UNKNOWN_ITEM']);
    expect(codes(issues([stock(999)], null))).toEqual([]);
  });
  it('does not call an item of 0 unknown as well', () => {
    expect(codes(issues([stock(0)], () => false))).toEqual(['error:VENDOR_NO_ITEM']);
  });
});
