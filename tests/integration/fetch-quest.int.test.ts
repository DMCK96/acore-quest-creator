import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mysql from 'mysql2/promise';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { writeFile, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApi } from '../../src/main/api';
import { openStore } from '../../src/main/store/store';
import { openMysqlWorldDb } from '@core/db/mysql-world-db';
import { openMysqlDevDb } from '@core/db/mysql-dev-db';
import { createMysqlScratch, type MysqlScratch } from '@core/roundtrip/mysql-gate';
import { addDropSource } from '../../src/renderer/groups/drops-model';
import { registry } from '@core/registry';
import { mysqlUrl } from '../helpers/env';

const u = new URL(mysqlUrl());
const conn = { host: u.hostname, port: Number(u.port || 3306), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password) };
const worldDb = u.pathname.slice(1);
const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };
let scratch: MysqlScratch; let admin: mysql.Connection; let outDir: string;
let starter: number, taker: number, takerFlag: number, wanted: number, reward: number, wolf: number;

beforeAll(async () => {
  admin = await mysql.createConnection(conn);
  scratch = await createMysqlScratch({ ...conn, worldDatabase: worldDb, tables: [...registry.tables.map((t) => t.table), 'creature_template'] });
  outDir = mkdtempSync(join(tmpdir(), 'acqc-fetch-'));
  const [givers] = await admin.query<any[]>(`SELECT entry, npcflag FROM \`${worldDb}\`.creature_template WHERE (npcflag & 2) = 2 ORDER BY entry LIMIT 3`);
  const [items] = await admin.query<any[]>(`SELECT entry FROM \`${worldDb}\`.item_template ORDER BY entry LIMIT 2 OFFSET 10`);
  const [beasts] = await admin.query<any[]>(`SELECT entry FROM \`${worldDb}\`.creature_template WHERE (npcflag & 2) = 0 ORDER BY entry LIMIT 2 OFFSET 20`);
  taker = givers[0].entry; takerFlag = givers[0].npcflag; starter = beasts[1].entry; // the starter deliberately lacks the quest-giver flag
  [wanted, reward] = [items[0].entry, items[1].entry]; wolf = beasts[0].entry;
  await admin.query(`INSERT INTO \`${scratch.schema}\`.creature_template SELECT * FROM \`${worldDb}\`.creature_template WHERE entry IN (?, ?)`, [starter, taker]);
});
afterAll(async () => { await scratch?.drop(); await admin?.end(); rmSync(outDir, { recursive: true, force: true }); });

describe('authoring a fetch quest end to end', () => {
  it('exports a patch that applies cleanly, twice, and yields a working quest', async () => {
    const store = openStore(':memory:', box);
    const api = createApi({
      store, openWorldDb: (p) => openMysqlWorldDb({ host: p.host, port: p.port, user: p.user, password: p.password, database: p.database }),
      openDevDb: (p) => openMysqlDevDb({ host: p.host, port: p.port, user: p.user, password: p.password, database: scratch.schema }),
      fs: { writeFile: (p, t) => writeFile(p, t, 'utf8'), ensureDir: async (p) => { await mkdir(p, { recursive: true }); }, listDir: (p) => readdir(p) },
      now: () => new Date('2026-09-21T10:00:00Z'), defaultOutputDir: outDir,
    });
    const ok = async <T,>(r: Promise<any>): Promise<T> => { const x = await r; if (!x.ok) throw new Error(JSON.stringify(x.error)); return x.value; };
    const world = await ok<any>(api.saveProfile({ name: 'w', role: 'world', host: conn.host, port: conn.port, user: conn.user, database: worldDb, password: conn.password }));
    await ok(api.saveProfile({ name: 'dev', role: 'dev', host: conn.host, port: conn.port, user: conn.user, database: worldDb, password: conn.password }));
    await ok(api.connect(world.id));

    const fresh = await ok<any>(api.newQuest());
    let values: Record<string, any> = {
      ...fresh.aggregate.values,
      'quest_template.LogTitle': "Wolf Pelts, 'Fresh'", 'quest_template.QuestLevel': 10, 'quest_template.MinLevel': 8,
      'quest_template.QuestDescription': 'Bring me $B3 pelts, $N.\r\nQuickly!', 'quest_template.LogDescription': 'Collect 3 pelts.',
      'quest_template.RequiredItems': [{ item: wanted, count: 3 }], 'quest_template.RewardItems': [{ item: reward, amount: 1 }],
      'quest_template.RewardMoney': 1234,
      'quest_offer_reward.RewardText': 'Well done.', 'quest_request_items.CompletionText': 'Have the pelts?',
      creature_queststarter: [{ id: starter }], creature_questender: [{ id: taker }],
    };
    values = addDropSource(values, wanted, { source: { kind: 'creature', entry: wolf }, chance: 60, minCount: 1, maxCount: 1 });
    await ok(api.saveDraft({ ...fresh.aggregate, values }));

    const issues = await ok<any[]>(api.validate(fresh.questId));
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);

    const exported = await ok<any>(api.exportQuest(fresh.questId));
    expect(readFileSync(exported.path, 'utf8')).toBe(exported.sql);
    const applied = await ok<any>(api.applyToDev(fresh.questId, true));
    expect(applied.statements).toBeGreaterThan(5);
    await ok(api.applyToDev(fresh.questId, true)); // re-applicable

    const q = (t: string, w: string) => admin.query<any[]>(`SELECT * FROM \`${scratch.schema}\`.\`${t}\` WHERE ${w}`).then(([r]) => r);
    const id = fresh.questId;
    const [row] = await q('quest_template', `ID = ${id}`);
    expect(row).toMatchObject({ LogTitle: "Wolf Pelts, 'Fresh'", QuestLevel: 10, RequiredItemId1: wanted, RequiredItemCount1: 3, RewardItem1: reward, RewardMoney: 1234 });
    expect(row.QuestDescription).toBe('Bring me $B3 pelts, $N.\r\nQuickly!');
    expect(await q('creature_queststarter', `quest = ${id}`)).toEqual([{ id: starter, quest: id }]);
    expect(await q('creature_questender', `quest = ${id}`)).toEqual([{ id: taker, quest: id }]);
    expect((await q('quest_offer_reward', `ID = ${id}`))[0].RewardText).toBe('Well done.');
    expect((await q('quest_request_items', `ID = ${id}`))[0].CompletionText).toBe('Have the pelts?');
    expect(await q('creature_loot_template', `Entry = ${wolf} AND Item = ${wanted}`)).toHaveLength(1);
    expect(await q('quest_template', `ID = ${id}`)).toHaveLength(1);

    // the unflagged starter was made a quest giver; the ender already was and is unchanged
    const npcs = await q('creature_template', `entry IN (${starter}, ${taker})`);
    expect(npcs.find((n: any) => n.entry === starter).npcflag & 2).toBe(2);
    expect(npcs.find((n: any) => n.entry === taker).npcflag).toBe(takerFlag);
    expect(issues.some((i) => i.code === 'NOT_QUESTGIVER')).toBe(false);
  });
});
