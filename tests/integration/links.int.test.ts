import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mysql from 'mysql2/promise';
import { openMysqlWorldDb } from '@core/db/mysql-world-db';
import type { WorldDb } from '@core/db/world-db';
import { findQuestChain } from '@core/import/quest-chain';
import { readItemStarters, readLinkContext } from '@core/links/context';
import { readWorldFacts } from '@core/links/facts';
import { recogniseLinks } from '@core/links/recognise';
import { mysqlUrl } from '../helpers/env';

const u = new URL(mysqlUrl());
const conn = { host: u.hostname, port: Number(u.port || 3306), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password) };
const database = u.pathname.slice(1);
let db: WorldDb;
beforeAll(async () => { db = await openMysqlWorldDb({ ...conn, database }); });
afterAll(async () => { await db?.close(); });

describe('links against the real world DB', () => {
  it('walks the whole Defias Brotherhood chain from a quest in the middle', async () => {
    const chain = await findQuestChain(db, 155);
    expect(chain.questIds).toEqual(expect.arrayContaining([65, 132, 135, 141, 142, 155, 166]));
    expect(chain.truncated).toBe(false);
  }, 30000);
  it('recognises a quest the world DB starts through SmartAI', async () => {
    const admin = await mysql.createConnection(conn);
    const [rows] = await admin.query<any[]>(`SELECT action_param1 AS quest FROM \`${database}\`.smart_scripts WHERE action_type = 7 AND source_type IN (0, 1, 2) AND action_param1 > 0 ORDER BY entryorguid LIMIT 1`);
    await admin.end();
    expect(rows).toHaveLength(1);
    const questId = Number(rows[0].quest);
    const facts = await readWorldFacts(db, [questId]);
    const result = recogniseLinks({ facts, context: await readLinkContext(db, [questId]) });
    expect(result.instances.some((i) => i.component === 'start.smartai' && i.owner === questId)).toBe(true);
    expect(result.instances.some((i) => i.component === 'start.backend' && i.owner === questId)).toBe(false);
  }, 30000);
  it('reads item starters in one pass that agrees with the per-quest item_template read', async () => {
    const starters = await readItemStarters(db);
    expect(starters.length).toBeGreaterThan(0);
    const questId = starters[0].questId;
    expect((await readLinkContext(db, [questId], starters)).itemStarters)
      .toEqual((await readLinkContext(db, [questId])).itemStarters);
  }, 30000);
  it('walks the Defias chain within its budget once item starters come from the session', async () => {
    const starters = await readItemStarters(db);
    const started = performance.now();
    const chain = await findQuestChain(db, 155, undefined, undefined, starters);
    const elapsed = performance.now() - started;
    console.info(`findQuestChain(155): ${chain.questIds.length} quests in ${Math.round(elapsed)} ms`);
    expect(chain.questIds).toEqual(expect.arrayContaining([65, 132, 135, 141, 142, 155, 166]));
    // Generous against the spec's ~150 ms so a slow network does not flake it, yet far below the
    // several seconds a per-step full scan of an unindexed column costs.
    expect(elapsed).toBeLessThan(3000);
  }, 30000);
});
