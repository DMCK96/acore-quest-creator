import { describe, expect, it } from 'vitest';
import { areaOverview } from '../../src/core/lore/area';
import { UnknownTableError, type WorldDb } from '../../src/core/db/world-db';
import { forkDb } from '../helpers/fixtures';

const QUERY = { map: 0, x: -9465, y: 30, radius: 50 };
const names = { faction: () => undefined };

function world() {
  const db = forkDb();
  db.insert('creature_template', { entry: '54', name: 'Brog Hamfist', minlevel: '30', maxlevel: '30', faction: '11', npcflag: '4225', lootid: '0' });
  db.insert('creature_template', { entry: '69', name: 'Timber Wolf', minlevel: '3', maxlevel: '4', faction: '38', npcflag: '0', lootid: '69' });
  const at = (guid: number, id1: number, x: number, y: number) =>
    db.insert('creature', { guid: String(guid), id1: String(id1), map: '0', position_x: String(x), position_y: String(y), position_z: '200', orientation: '0' });
  at(2, 54, -9465, 40);
  at(3, 69, -9480, 50);
  for (const [entry, name] of [[159, 'Refreshing Spring Water'], [117, 'Tough Jerky'], [769, 'Chunk of Boar Meat'], [1015, 'Lean Wolf Flank'], [2001, 'Wolf Pelt'], [2002, 'Wolf Fang'], [4656, 'Small Pumpkin']] as const) {
    db.insert('item_template', { entry: String(entry), name });
  }
  db.insert('npc_vendor', { entry: '54', slot: '2', item: '117' });
  db.insert('npc_vendor', { entry: '54', slot: '1', item: '159' });
  // Loot of entry 69: two plain rows, a group of two with no chance of their own, and a reference
  db.insert('creature_loot_template', { Entry: '69', Item: '769', Reference: '0', Chance: '50', GroupId: '0' });
  db.insert('creature_loot_template', { Entry: '69', Item: '1015', Reference: '0', Chance: '30', GroupId: '0' });
  db.insert('creature_loot_template', { Entry: '69', Item: '2001', Reference: '0', Chance: '0', GroupId: '1' });
  db.insert('creature_loot_template', { Entry: '69', Item: '2002', Reference: '0', Chance: '0', GroupId: '1' });
  db.insert('creature_loot_template', { Entry: '69', Item: '0', Reference: '24', Chance: '100', GroupId: '0' });
  db.insert('reference_loot_template', { Entry: '24', Item: '4656', Reference: '0', Chance: '5', GroupId: '0' });
  return db;
}

const without = (db: WorldDb, table: string): WorldDb =>
  new Proxy(db, {
    get(target, key) {
      if (key === 'columns') return async (name: string) => (name === table ? [] : target.columns(name));
      if (key === 'selectRows') return async (name: string, where: never) => { if (name === table) throw new UnknownTableError(name); return target.selectRows(name, where); };
      const value = (target as never)[key];
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
    },
  });

describe('areaOverview vendor stock and drops', () => {
  it('lists what a vendor sells in slot order, named', async () => {
    const out = await areaOverview(world(), QUERY, names);
    expect(out.npcs.find((n) => n.entry === 54)!.vendor).toEqual([{ item: 159, name: 'Refreshing Spring Water' }, { item: 117, name: 'Tough Jerky' }]);
    expect(out.npcs.find((n) => n.entry === 69)!.vendor).toEqual([]);
  });

  it("lists drops by chance, shares a group's chance between its rows, and follows one level of reference", async () => {
    const out = await areaOverview(world(), QUERY, names);
    const drops = out.npcs.find((n) => n.entry === 69)!.drops;
    expect(drops).toEqual([
      { item: 769, name: 'Chunk of Boar Meat', chance: 50, group: 0, viaReference: null },
      { item: 2001, name: 'Wolf Pelt', chance: 50, group: 1, viaReference: null },
      { item: 2002, name: 'Wolf Fang', chance: 50, group: 1, viaReference: null },
      { item: 1015, name: 'Lean Wolf Flank', chance: 30, group: 0, viaReference: null },
      { item: 4656, name: 'Small Pumpkin', chance: 5, group: 0, viaReference: 24 },
    ]);
  });

  it('gives an NPC with no loot table no drops', async () => {
    expect((await areaOverview(world(), QUERY, names)).npcs.find((n) => n.entry === 54)!.drops).toEqual([]);
  });

  it('cuts vendor stock and drops at their limits and says so', async () => {
    const out = await areaOverview(world(), QUERY, names, { vendorItems: 1, drops: 2 });
    expect(out.npcs.find((n) => n.entry === 54)!.vendor).toHaveLength(1);
    expect(out.npcs.find((n) => n.entry === 69)!.drops).toHaveLength(2);
    expect(out.truncated.vendor).toBe(true);
    expect(out.truncated.drops).toBe(true);
  });

  it('leaves vendor stock empty and names npc_vendor when the fork lacks it', async () => {
    const out = await areaOverview(without(world(), 'npc_vendor'), QUERY, names);
    expect(out.missing).toContain('npc_vendor');
    expect(out.npcs.find((n) => n.entry === 54)!.vendor).toEqual([]);
    expect(out.npcs.find((n) => n.entry === 69)!.drops.length).toBeGreaterThan(0);
  });

  it('keeps the plain drops and names reference_loot_template when only that table is missing', async () => {
    const out = await areaOverview(without(world(), 'reference_loot_template'), QUERY, names);
    expect(out.missing).toEqual(['reference_loot_template']);
    expect(out.npcs.find((n) => n.entry === 69)!.drops.map((d) => d.item)).toEqual([769, 2001, 2002, 1015]);
  });

  it('names creature_loot_template and gives no drops when the fork lacks it', async () => {
    const out = await areaOverview(without(world(), 'creature_loot_template'), QUERY, names);
    expect(out.missing).toEqual(['creature_loot_template']);
    expect(out.npcs.find((n) => n.entry === 69)!.drops).toEqual([]);
  });
});
