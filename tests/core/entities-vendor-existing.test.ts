import { describe, expect, it } from 'vitest';
import { existingStatements } from '../../src/core/entities/existing';
import { npcFromRows } from '../../src/core/entities/from-rows';
import { EMPTY_ENTITIES, type CustomNpc } from '../../src/core/entities/model';

const template = { entry: '54', name: 'Innkeeper', subname: '', minlevel: '10', maxlevel: '10', faction: '11', rank: '0', type: '7', npcflag: '2177', lootid: '0', AIName: '', ScriptName: '' };
const row = (slot: string, item: string, extra: Record<string, string> = {}) =>
  ({ entry: '54', slot, item, maxcount: '0', incrtime: '0', ExtendedCost: '0', VerifiedBuild: '12340', ...extra });
const model = { CreatureID: '54', Idx: '0', CreatureDisplayID: '3167', DisplayScale: '1', Probability: '1' };
const stocked = { creature_template: [template], creature_template_model: [model], npc_vendor: [row('0', '159'), row('1', '117', { maxcount: '5', incrtime: '900' })] };
const bare = { creature_template: [{ ...template, npcflag: '2049' }], creature_template_model: [model], npc_vendor: [] };
const counts = { sharedLoot: 0, spawnCount: 1 };
const store = (npc: CustomNpc) => ({ ...EMPTY_ENTITIES, npcs: [npc] });
const vendorStatements = (npc: CustomNpc) => {
  const out = existingStatements(store(npc), []);
  return { apply: out.apply.filter((s) => s.table === 'npc_vendor'), revert: out.revert.filter((s) => s.table === 'npc_vendor') };
};
const flagOf = (npc: CustomNpc) => {
  const insert = existingStatements(store(npc), []).apply.find((s) => s.table === 'creature_template' && s.kind === 'insert') as { row: Record<string, string> };
  return Number(insert.row.npcflag);
};

describe('writing an existing NPC\'s vendor stock', () => {
  it('writes nothing for stock it only read, and leaves npcflag as it was', () => {
    const npc = npcFromRows(54, stocked, counts);
    expect(vendorStatements(npc).apply).toEqual([]);
    expect(vendorStatements(npc).revert).toEqual([]);
    expect(flagOf(npc)).toBe(2177);
  });

  it('replaces the list: deletes by entry, inserts the rows with slots, and the revert puts the originals back', () => {
    const npc = npcFromRows(54, stocked, counts);
    const edited = { ...npc, vendor: [npc.vendor[1]!, { item: 4540, maxCount: 0, restockSecs: 600, extendedCost: 0 }, npc.vendor[0]!] };
    const { apply, revert } = vendorStatements(edited);
    expect(apply).toEqual([
      { kind: 'delete', table: 'npc_vendor', key: { entry: '54' } },
      { kind: 'insert', table: 'npc_vendor', row: row('0', '117', { maxcount: '5', incrtime: '900' }) },
      { kind: 'insert', table: 'npc_vendor', row: { entry: '54', slot: '1', item: '4540', maxcount: '0', incrtime: '0', ExtendedCost: '0' } },
      { kind: 'insert', table: 'npc_vendor', row: row('2', '159') },
    ]);
    expect(revert).toEqual([
      { kind: 'delete', table: 'npc_vendor', key: { entry: '54' } },
      { kind: 'insert', table: 'npc_vendor', row: row('0', '159') },
      { kind: 'insert', table: 'npc_vendor', row: row('1', '117', { maxcount: '5', incrtime: '900' }) },
    ]);
    expect(flagOf(edited)).toBe(2177);
  });

  it('writes the restock time as 0 for unlimited stock', () => {
    const npc = npcFromRows(54, bare, counts);
    const { apply } = vendorStatements({ ...npc, vendor: [{ item: 5, maxCount: 0, restockSecs: 900, extendedCost: 77 }] });
    expect(apply[1]).toEqual({ kind: 'insert', table: 'npc_vendor', row: { entry: '54', slot: '0', item: '5', maxcount: '0', incrtime: '0', ExtendedCost: '77' } });
  });

  it('sets the vendor bit when stock is added to an NPC without any', () => {
    const npc = npcFromRows(54, bare, counts);
    expect(flagOf({ ...npc, vendor: [{ item: 5, maxCount: 0, restockSecs: 0, extendedCost: 0 }] })).toBe(2049 | 128);
  });

  it('clears only the vendor bit when all stock is removed, keeping sub-type bits', () => {
    const npc = npcFromRows(54, stocked, counts);
    const { apply } = vendorStatements({ ...npc, vendor: [] });
    expect(apply).toEqual([{ kind: 'delete', table: 'npc_vendor', key: { entry: '54' } }]);
    expect(flagOf({ ...npc, vendor: [] })).toBe(2177 & ~128);
  });

  it('treats stock added and removed again as unchanged', () => {
    const npc = npcFromRows(54, bare, counts);
    const back = { ...npc, vendor: [] };
    expect(vendorStatements(back).apply).toEqual([]);
    expect(flagOf(back)).toBe(2049);
  });

  it('never touches stock it did not read (a project saved before vendors existed)', () => {
    const { npc_vendor: _unread, ...unreadRows } = stocked;
    const npc = npcFromRows(54, unreadRows, counts);
    const edited = { ...npc, vendor: [{ item: 5, maxCount: 0, restockSecs: 0, extendedCost: 0 }] };
    expect(vendorStatements(edited).apply).toEqual([]);
    expect(flagOf(edited)).toBe(2177);
  });
});

describe('telling whether stock changed', () => {
  it('compares the rows by value, not by the order of their properties', () => {
    const npc = npcFromRows(54, stocked, counts);
    const shuffled = npc.vendor.map((v) => ({ extendedCost: v.extendedCost, restockSecs: v.restockSecs, maxCount: v.maxCount, item: v.item }));
    expect(vendorStatements({ ...npc, vendor: shuffled }).apply).toEqual([]);
    expect(flagOf({ ...npc, vendor: shuffled })).toBe(2177);
  });
});
