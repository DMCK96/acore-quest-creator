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

describe('vendor stock checks the server also makes', () => {
  const limited = (restockSecs: number): VendorItem => ({ item: 5, maxCount: 5, restockSecs, extendedCost: 0 });
  const check = (vendor: VendorItem[], over: Partial<Parameters<typeof entityIssues>[0]> = {}, base: Partial<CustomNpc> = {}) =>
    entityIssues({ entities: { npcs: [{ ...npc(vendor), ...base }], objects: [], items: [] }, dbNames: new Map(), ...over });

  it('errors on limited stock that never restocks, which the server would not load', () => {
    expect(codes(check([limited(0)]))).toEqual(['error:VENDOR_NO_RESTOCK']);
    expect(check([limited(0)])[0]!.message).toContain('item 5');
    expect(check([limited(900)])).toEqual([]);
    expect(check([{ item: 5, maxCount: 0, restockSecs: 0, extendedCost: 0 }])).toEqual([]);
  });

  it('accepts a negative item as a reference to another vendor\'s list, and does not look it up', () => {
    expect(check([stock(-54)], { knownItem: () => false })).toEqual([]);
  });

  it('warns about an extended cost the server\'s DBC does not have, only when it can tell', () => {
    expect(codes(check([stock(5, 99)], { knownExtendedCost: (id) => id !== 99 }))).toEqual(['warning:VENDOR_UNKNOWN_COST']);
    expect(check([stock(5, 99)], { knownExtendedCost: null })).toEqual([]);
    expect(check([stock(5, 0)], { knownExtendedCost: () => false })).toEqual([]);
  });

  it('warns about a list longer than the server reads', () => {
    const many = Array.from({ length: 151 }, (_, i) => stock(i + 1));
    expect(codes(check(many))).toEqual(['warning:VENDOR_TOO_MANY']);
    expect(check(many.slice(0, 150))).toEqual([]);
  });

  it('warns that stock set on an NPC whose stock was never read is not written', () => {
    const unread = { kind: 'existing' as const, original: { creature_template: [] }, sharedLoot: 0, spawnCount: 1, locked: [] };
    expect(codes(check([stock(5)], {}, { origin: unread }))).toEqual(['warning:VENDOR_NOT_READ']);
    expect(check([], {}, { origin: unread })).toEqual([]);
    expect(check([stock(5)], {}, { origin: { ...unread, original: { npc_vendor: [] } } })).toEqual([]);
  });
});
