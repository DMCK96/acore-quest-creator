import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { openMysqlWorldDb, WorldDbConnectionError } from '@core/db/mysql-world-db';
import { UnknownColumnError, UnknownTableError, type WorldDb } from '@core/db/world-db';
import { mysqlUrl } from '../helpers/env';

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
  it('reports a named error when the server is unreachable', async () => {
    await expect(openMysqlWorldDb({ ...opts(), port: 1 })).rejects.toBeInstanceOf(WorldDbConnectionError);
  });
});
