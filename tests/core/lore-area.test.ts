import { describe, expect, it } from 'vitest';
import { areaOverview } from '../../src/core/lore/area';
import { UnknownTableError, type WorldDb } from '../../src/core/db/world-db';
import { forkDb } from '../helpers/fixtures';

const QUERY = { map: 0, x: -9465, y: 30, radius: 50 };
const names = { faction: (id: number) => (id === 11 ? 'Stormwind' : undefined) };

/** A world with an inn, a smith, an anvil and wolves around (-9465, 30), and one wolf far away. */
function world() {
  const db = forkDb();
  db.insert('creature_template', { entry: '295', name: 'Innkeeper Farley', subname: 'Innkeeper', minlevel: '55', maxlevel: '55', faction: '11', npcflag: '65539', rank: '0' });
  db.insert('creature_template', { entry: '54', name: 'Brog Hamfist', subname: 'Blacksmith', minlevel: '30', maxlevel: '31', faction: '11', npcflag: '4225', rank: '1' });
  db.insert('creature_template', { entry: '69', name: 'Timber Wolf', minlevel: '3', maxlevel: '4', faction: '38', npcflag: '0', rank: '0' });
  const at = (guid: number, id1: number, x: number, y: number, orientation: number, extra: Record<string, string> = {}) =>
    db.insert('creature', { guid: String(guid), id1: String(id1), map: '0', position_x: String(x), position_y: String(y), position_z: '200', orientation: String(orientation), ...extra });
  at(1, 295, -9462, 16, 3.14159);
  at(2, 54, -9465, 40, 1.5708);
  at(3, 69, -9480, 50, 0.1, { wander_distance: '8', MovementType: '1' });
  at(4, 69, -9470, 60, 4.7124);
  at(5, 69, -9420, 75, 0); // inside the box, but 63.6 yards away
  at(9, 69, -9000, 500, 0); // far away
  db.insert('gameobject_template', { entry: '500', type: '8', displayId: '1', name: 'Anvil', size: '1' });
  db.insert('gameobject', { guid: '7', id: '500', map: '0', position_x: '-9468', position_y: '33', position_z: '200', orientation: '1.5708', rotation0: '0', rotation1: '0', rotation2: '0.7071', rotation3: '0.7071' });
  db.insert('quest_template', { ID: '33', LogTitle: 'Kobold Camp Cleanup', QuestLevel: '10' });
  db.insert('quest_template', { ID: '34', LogTitle: 'Anvil Work', QuestLevel: '5' });
  db.insert('creature_queststarter', { id: '295', quest: '33' });
  db.insert('creature_questender', { id: '54', quest: '33' });
  db.insert('gameobject_queststarter', { id: '500', quest: '34' });
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

describe('areaOverview', () => {
  it('finds the NPCs in the circle, nearest first, and leaves out the ones in the corners and far away', async () => {
    const out = await areaOverview(world(), QUERY, names);
    expect(out.query).toEqual(QUERY);
    expect(out.npcs.map((n) => n.entry)).toEqual([54, 295, 69]);
    const wolf = out.npcs.find((n) => n.entry === 69)!;
    expect(wolf.spawnCount).toBe(2);
    expect(wolf.spawns.map((s) => s.guid)).toEqual([3, 4]);
  });

  it('gives each spawn what is needed to place something beside it: position, offset, distance and the way it faces', async () => {
    const out = await areaOverview(world(), QUERY, names);
    const farley = out.npcs.find((n) => n.entry === 295)!.spawns[0]!;
    expect(farley).toMatchObject({ guid: 1, x: -9462, y: 16, z: 200, dx: 3, dy: -14, distance: 14.3, facing: 'S' });
    expect(farley.orientation).toBeCloseTo(3.1416, 4);
    const brog = out.npcs.find((n) => n.entry === 54)!.spawns[0]!;
    expect(brog).toMatchObject({ dx: 0, dy: 10, distance: 10, facing: 'W' });
    const wolf = out.npcs.find((n) => n.entry === 69)!.spawns[1]!;
    expect(wolf.facing).toBe('E');
  });

  it('describes the NPC: level, rank, subname, roles and faction', async () => {
    const out = await areaOverview(world(), QUERY, names);
    const farley = out.npcs.find((n) => n.entry === 295)!;
    expect(farley).toMatchObject({ name: 'Innkeeper Farley', subname: 'Innkeeper', level: { min: 55, max: 55 }, rank: 0, faction: { template: 11, name: 'Stormwind' } });
    expect(farley.roles).toEqual(['gossip', 'quest giver', 'innkeeper']);
    const brog = out.npcs.find((n) => n.entry === 54)!;
    expect(brog.roles).toEqual(['gossip', 'vendor', 'repairer']);
    expect(brog.level).toEqual({ min: 30, max: 31 });
    const wolf = out.npcs.find((n) => n.entry === 69)!;
    expect(wolf.roles).toEqual([]);
    expect(wolf.faction).toEqual({ template: 38, name: null });
    expect(wolf.spawns[0]!.wander).toBe(8);
  });

  it('lists objects with their raw rotation', async () => {
    const out = await areaOverview(world(), QUERY, names);
    expect(out.objects).toHaveLength(1);
    const anvil = out.objects[0]!;
    expect(anvil).toMatchObject({ entry: 500, name: 'Anvil', type: 8, spawnCount: 1 });
    expect(anvil.spawns[0]).toMatchObject({ guid: 7, dx: -3, dy: 3, facing: 'W' });
    expect(anvil.spawns[0]!.rotation).toEqual([0, 0, 0.7071, 0.7071]);
  });

  it('lists the quests the NPCs and objects start and end, and who is involved', async () => {
    const out = await areaOverview(world(), QUERY, names);
    expect(out.quests).toEqual([{ id: 34, title: 'Anvil Work', level: 5 }, { id: 33, title: 'Kobold Camp Cleanup', level: 10 }]);
    expect(out.npcs.find((n) => n.entry === 295)!.starts).toEqual([33]);
    expect(out.npcs.find((n) => n.entry === 54)!.ends).toEqual([33]);
    expect(out.objects[0]!.starts).toEqual([34]);
  });

  it('counts the factions of the NPCs found', async () => {
    const out = await areaOverview(world(), QUERY, names);
    expect(out.factions).toEqual([{ template: 11, name: 'Stormwind', npcs: 2 }, { template: 38, name: null, npcs: 1 }]);
  });

  it('cuts to the limits and says which list it cut', async () => {
    const out = await areaOverview(world(), QUERY, names, { npcs: 2, spawnsPerEntry: 1 });
    expect(out.npcs.map((n) => n.entry)).toEqual([54, 295]);
    expect(out.truncated.npcs).toBe(true);
    const cutSpawns = await areaOverview(world(), QUERY, names, { spawnsPerEntry: 1 });
    expect(cutSpawns.npcs.find((n) => n.entry === 69)!.spawns).toHaveLength(1);
    expect(cutSpawns.npcs.find((n) => n.entry === 69)!.spawnCount).toBe(2);
    expect(cutSpawns.truncated.spawns).toBe(true);
    const cutQuests = await areaOverview(world(), QUERY, names, { quests: 1 });
    expect(cutQuests.quests).toHaveLength(1);
    expect(cutQuests.truncated.quests).toBe(true);
  });

  it('says nothing was cut when nothing was', async () => {
    const out = await areaOverview(world(), QUERY, names);
    expect(out.truncated).toEqual({ npcs: false, objects: false, quests: false, spawns: false, vendor: false, drops: false, read: false });
    expect(out.missing).toEqual([]);
  });

  it('finds nothing for an empty place', async () => {
    const out = await areaOverview(world(), { map: 1, x: 0, y: 0, radius: 100 }, names);
    expect(out.npcs).toEqual([]);
    expect(out.objects).toEqual([]);
    expect(out.quests).toEqual([]);
    expect(out.factions).toEqual([]);
  });

  it('leaves a section empty and names the table when the fork lacks a quest-giver table', async () => {
    const out = await areaOverview(without(world(), 'creature_questender'), QUERY, names);
    expect(out.missing).toEqual(['creature_questender']);
    expect(out.npcs.find((n) => n.entry === 54)!.ends).toEqual([]);
    expect(out.npcs.find((n) => n.entry === 295)!.starts).toEqual([33]);
  });

  it('refuses a connection that cannot list spawns', async () => {
    const db = world();
    const bare = new Proxy(db, { get: (t, k) => (k === 'spawnsForView' ? undefined : (t as never)[k]) });
    await expect(areaOverview(bare, QUERY, names)).rejects.toThrow(/cannot list spawns/);
  });

  it('says when it only read part of a crowded box, and still answers from what it read', async () => {
    const out = await areaOverview(world(), QUERY, names, { spawnRead: 2 });
    expect(out.truncated.read).toBe(true);
    expect(out.npcs.length).toBeGreaterThan(0);
  });

  it('caps how many quests an NPC lists as started and ended, and says so', async () => {
    const db = world();
    for (let i = 0; i < 12; i++) {
      db.insert('quest_template', { ID: String(500 + i), LogTitle: `Q${i}`, QuestLevel: '5' });
      db.insert('creature_queststarter', { id: '295', quest: String(500 + i) });
    }
    const out = await areaOverview(db, QUERY, names, { quests: 100 });
    expect(out.npcs.find((n) => n.entry === 295)!.starts).toHaveLength(10);
    expect(out.truncated.quests).toBe(true);
  });
});
