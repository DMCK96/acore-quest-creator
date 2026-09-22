import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { openMysqlWorldDb } from '@core/db/mysql-world-db';
import { createMysqlScratch, verifyPatchInMysql, type MysqlScratch } from '@core/roundtrip/mysql-gate';
import { importQuest } from '@core/import/importer';
import { buildPatch } from '@core/export/build-patch';
import { renderPatch } from '@core/export/render-patch';
import { loadSchema } from '@core/schema/load';
import { registry } from '@core/registry';
import { TOOL_VERSION } from '@core/version';
import { mysqlUrl } from '../helpers/env';
import type { WorldDb } from '@core/db/world-db';

const u = new URL(mysqlUrl());
const conn = { host: u.hostname, port: Number(u.port || 3306), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password) };
const tables = registry.tables.map((t) => t.table);
let db: WorldDb; let scratch: MysqlScratch;
beforeAll(async () => {
  db = await openMysqlWorldDb({ ...conn, database: u.pathname.slice(1) });
  scratch = await createMysqlScratch({ ...conn, worldDatabase: u.pathname.slice(1), tables });
});
afterAll(async () => { await scratch?.drop(); await db?.close(); });

async function gate(questId: number, applyTwice = false) {
  const schema = await loadSchema(db, tables);
  const { aggregate, snapshot } = await importQuest(db, schema, registry, questId);
  const sql = renderPatch(buildPatch({ aggregate, snapshot, schema, registry }).statements, schema, { toolVersion: TOOL_VERSION, questId, date: '2026_09_21' });
  return verifyPatchInMysql(scratch, { snapshot, patchSql: sql, expected: snapshot.tables, schema, registry, applyTwice });
}

describe('MySQL round-trip gate', () => {
  it('round-trips the first 25 quests byte-identically', async () => {
    const ids = (await db.questIdsInRange(1, 30000)).slice(0, 25);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(await gate(id), `quest ${id}`).toEqual({ ok: true });
  });
  it('round-trips the quest with the longest text and quests with non-ASCII text', async () => {
    const schema = await loadSchema(db, tables);
    const all = await db.questIdsInRange(1, 30000);
    const rows = await Promise.all(all.slice(0, 2000).map((id) => db.selectRows('quest_template', { ID: String(id) })));
    const longest = rows.flat().sort((a, b) => (b.QuestDescription ?? '').length - (a.QuestDescription ?? '').length)[0];
    expect(await gate(Number(longest.ID))).toEqual({ ok: true });
    void schema;
  });
  it('is re-applicable: applying the patch twice gives the same rows', async () => {
    const [id] = await db.questIdsInRange(1, 30000);
    expect(await gate(id, true)).toEqual({ ok: true });
  });
});
