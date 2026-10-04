import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { openMysqlWorldDb, WorldDbConnectionError } from '@core/db/mysql-world-db';
import { UnknownColumnError, UnknownTableError, type WorldDb } from '@core/db/world-db';
import { mysqlUrl } from '../helpers/env';
import { countWalkers, readRoute } from '../../src/main/world/world-api';

function opts() {
  const u = new URL(mysqlUrl());
  return { host: u.hostname, port: Number(u.port || 3306), user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password), database: u.pathname.slice(1) };
}
let db: WorldDb;
beforeAll(async () => { db = await openMysqlWorldDb(opts()); });
afterAll(async () => { await db?.close(); });

describe('MysqlWorldDb', () => {
  it('introspects columns in ordinal order with keys', async () => {
    const cols = await db.columns('quest_template');
    expect(cols[0]).toMatchObject({ name: 'ID', ordinal: 1, isKey: true });
    expect(cols.length).toBeGreaterThanOrEqual(105);
    expect(await db.columns('definitely_not_a_table')).toEqual([]);
  });
  it('returns every value as text or null', async () => {
    const rows = await db.selectRows('quest_template', { ID: '1' });
    for (const v of Object.values(rows[0] ?? {})) expect(v === null || typeof v === 'string').toBe(true);
  });
  it('orders by key columns numerically', async () => {
    const rows = await db.selectRows('quest_template', { ID: ['100', '9', '20'] });
    expect(rows.map((r) => Number(r.ID))).toEqual([...rows.map((r) => Number(r.ID))].sort((a, b) => a - b));
  });
  it('refuses unknown or hostile identifiers', async () => {
    await expect(db.selectRows('quest_template; DROP TABLE x', {})).rejects.toBeInstanceOf(UnknownTableError);
    await expect(db.selectRows('quest_template', { 'ID`=1 OR `1': '1' })).rejects.toBeInstanceOf(UnknownColumnError);
  });
  it('binds values as parameters', async () => {
    expect(await db.selectRows('quest_template', { ID: "1' OR '1'='1" })).toEqual([]);
  });
  it('looks up names and existence', async () => {
    const [item] = await db.selectRows('item_template', {}).then((r) => r.slice(0, 1));
    const id = Number(item.entry);
    expect((await db.lookupNames('item', [id])).get(id)).toBe(item.name);
    expect([...(await db.existingIds('item', [id, 2147480000]))]).toEqual([id]);
  });
  it('searches creatures and items by name against the real world DB', async () => {
    const hits = await db.searchEntities('creature', 'wolf', 25);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThanOrEqual(25);
    expect(hits.every((h) => h.name.toLowerCase().includes('wolf'))).toBe(true);
    expect(await db.searchEntities('item', "'; DROP TABLE x; --", 25)).toEqual([]);
    const [first] = await db.searchEntities('item', '25', 25);
    expect(first?.id).toBe(25);
  });
  it('searches quests and lists ids in a range', async () => {
    const hits = await db.searchQuests('a', 5);
    expect(hits.length).toBeLessThanOrEqual(5);
    const ids = await db.questIdsInRange(0, 30000);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });
  it('gives the 3D view Northshire Abbey\'s spawns with their looks, facing and routes', async () => {
    const box = { minX: -9000, maxX: -8800, minY: -250, maxY: -50 };
    const { creatures, objects } = await db.spawnsForView!(0, box, 2000);
    const mcBride = creatures.find((c) => c.guid === 79970);
    expect(mcBride).toMatchObject({ entry: 197, name: 'Marshal McBride', map: 0, own: false });
    expect(mcBride!.displayId).toBeGreaterThan(0);
    expect(mcBride!.scale).toBeGreaterThan(0);
    // Every spawn is in the box and on the map, ordered by guid
    for (const s of [...creatures, ...objects]) {
      expect(s.map).toBe(0);
      expect(s.x >= box.minX && s.x <= box.maxX && s.y >= box.minY && s.y <= box.maxY).toBe(true);
    }
    expect(creatures.map((c) => c.guid)).toEqual([...creatures.map((c) => c.guid)].sort((a, b) => a - b));
    // A route, when a creature has one, has points; a patroller does not also wander
    for (const c of creatures) if (c.path) expect(c.path.length).toBeGreaterThan(0);
    expect(objects.some((o) => o.displayId > 0)).toBe(true);
  });
  it('tells the 3D view which Goldshire spawns appear only during a game event', async () => {
    const box = { minX: -9500, maxX: -9400, minY: 0, maxY: 100 };
    const { creatures, objects } = await db.spawnsForView!(0, box, 2000);
    const evented = [...creatures, ...objects].filter((s) => s.event);
    expect(evented.length).toBeGreaterThan(0);
    for (const s of evented) expect(s.event!.id).toBeGreaterThan(0);
    expect([...creatures, ...objects].some((s) => s.event === null)).toBe(true);
  });
  it("tells the 3D view which Goldshire spawns an event takes away while it runs (Hallow's End, 12)", async () => {
    const { creatures } = await db.spawnsForView!(0, { minX: -9600, maxX: -9300, minY: -100, maxY: 200 }, 2000);
    const removed = creatures.filter((c) => c.removedBy.some((e) => e.id === 12));
    expect(removed.map((c) => c.guid)).toEqual(expect.arrayContaining([79648, 80341]));
    expect(removed[0]!.removedBy).toContainEqual({ id: 12, name: "Hallow's End" });
    // Taken away by an event, not brought by one: always in the world otherwise
    expect(removed.every((c) => c.events.length === 0 && c.event === null)).toBe(true);
    // A spawn an event brings lists it among its events
    for (const c of creatures.filter((s) => s.event)) expect(c.events).toContainEqual(c.event);
  });
  it('gives each patrolling Goldshire creature its route id and point data', async () => {
    const { creatures } = await db.spawnsForView!(0, { minX: -9600, maxX: -9300, minY: -100, maxY: 200 }, 2000);
    const walkers = creatures.filter((c) => c.path);
    expect(walkers.length).toBeGreaterThan(0);
    for (const c of walkers) {
      expect(c.pathId).toBeGreaterThan(0);
      expect(c.path![0]!.carry).toHaveProperty('delay');
    }
  });
  it('reads the route and walkers of a Goldshire patroller for the world layer as the view draws them', async () => {
    const { creatures } = await db.spawnsForView!(0, { minX: -9600, maxX: -9300, minY: -100, maxY: 200 }, 2000);
    const walker = creatures.find((c) => c.pathId > 0 && c.path)!;
    expect(await readRoute(db, walker.pathId)).toHaveLength(walker.path!.length);
    expect(await countWalkers(db, walker.pathId)).toBeGreaterThanOrEqual(1);
  });
  it('dresses Bianca Spada in Northshire by her display preset', async () => {
    const { creatures } = await db.spawnsForView!(0, { minX: -8930, maxX: -8910, minY: -140, maxY: -125 }, 2000);
    const bianca = creatures.find((c) => c.guid === 7500251)!;
    expect(bianca.preset).toMatchObject({ race: 1, sex: 1, hairStyle: 7, items: { chest: 13122, feet: 1246 } });
    expect(creatures.find((c) => c.entry === 823)?.preset ?? null).toBeNull();
  });
  it('reports a named error when the server is unreachable', async () => {
    await expect(openMysqlWorldDb({ ...opts(), port: 1 })).rejects.toBeInstanceOf(WorldDbConnectionError);
  });
});
