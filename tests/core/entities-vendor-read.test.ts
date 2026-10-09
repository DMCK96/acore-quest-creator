import { describe, expect, it } from 'vitest';
import { npcFromRows } from '../../src/core/entities/from-rows';
import { readOriginalRows } from '../../src/core/entities/existing';
import { newNpc, projectEntitiesSchema, readProjectEntities } from '../../src/core/entities/model';
import { forkDb } from '../helpers/fixtures';

const counts = { sharedLoot: 0, spawnCount: 1 };
const template = { entry: '54', name: 'Innkeeper', subname: '', minlevel: '10', maxlevel: '10', faction: '11', rank: '0', type: '7', npcflag: '129', lootid: '0', AIName: '', ScriptName: '' };
const row = (slot: string, item: string, extra: Record<string, string> = {}) =>
  ({ entry: '54', slot, item, maxcount: '0', incrtime: '0', ExtendedCost: '0', VerifiedBuild: '12340', ...extra });

describe('reading an existing NPC\'s vendor stock', () => {
  it('maps npc_vendor rows to the vendor list in slot order', () => {
    const rows = { creature_template: [template], npc_vendor: [row('2', '117', { maxcount: '5', incrtime: '900' }), row('0', '159', { ExtendedCost: '1234' }), row('1', '4540')] };
    const npc = npcFromRows(54, rows, counts);
    expect(npc.vendor).toEqual([
      { item: 159, maxCount: 0, restockSecs: 0, extendedCost: 1234 },
      { item: 4540, maxCount: 0, restockSecs: 0, extendedCost: 0 },
      { item: 117, maxCount: 5, restockSecs: 900, extendedCost: 0 },
    ]);
    expect(npc.origin).toMatchObject({ kind: 'existing', original: rows });
  });

  it('is empty when the NPC has no stock or the table was not read', () => {
    expect(npcFromRows(54, { creature_template: [template], npc_vendor: [] }, counts).vendor).toEqual([]);
    expect(npcFromRows(54, { creature_template: [template] }, counts).vendor).toEqual([]);
  });

  it('a new NPC has no stock, and an NPC saved before vendors existed loads with none', () => {
    expect(newNpc(1).vendor).toEqual([]);
    const { vendor: _dropped, ...old } = newNpc(7);
    const read = readProjectEntities({ npcs: [old], objects: [], items: [] });
    expect(read.npcs[0]!.vendor).toEqual([]);
    expect(projectEntitiesSchema.safeParse({ npcs: [{ ...newNpc(7), vendor: [{ item: 1, maxCount: -1, restockSecs: 0, extendedCost: 0 }] }], objects: [], items: [] }).success).toBe(false);
  });

  it('readOriginalRows reads the NPC\'s npc_vendor rows with its others', async () => {
    const db = forkDb();
    db.insert('creature_template', template);
    db.insert('npc_vendor', row('0', '159'));
    db.insert('npc_vendor', { ...row('0', '999'), entry: '55' });
    const read = await readOriginalRows(db, 'npc', 54);
    expect(read!.npc_vendor).toEqual([row('0', '159')]);
  });
});

describe('what a vendor list may hold', () => {
  it('holds at most 255 of an item, the width of npc_vendor.maxcount', () => {
    const with_ = (maxCount: number) => projectEntitiesSchema.safeParse({ npcs: [{ ...newNpc(7), vendor: [{ item: 1, maxCount, restockSecs: 0, extendedCost: 0 }] }], objects: [], items: [] }).success;
    expect(with_(255)).toBe(true);
    expect(with_(256)).toBe(false);
  });

  it('leaves the stock unread, so it is not edited, when the fork has no npc_vendor table', async () => {
    const { FakeWorldDb } = await import('../helpers/fake-world-db');
    const db = FakeWorldDb.fromFork(['creature_template', 'creature_template_model', 'creature_equip_template', 'creature_loot_template', 'creature', 'game_event_creature']);
    db.insert('creature_template', template);
    const read = await readOriginalRows(db, 'npc', 54);
    expect(read).not.toHaveProperty('npc_vendor');
  });
});
