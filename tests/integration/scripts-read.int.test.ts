import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { openMysqlWorldDb } from '@core/db/mysql-world-db';
import type { WorldDb } from '@core/db/world-db';
import { npcFromRows } from '../../src/core/entities/from-rows';
import { newNpc, type CustomNpc } from '../../src/core/entities/model';
import { readExistingRows } from '../../src/main/entities/existing';
import { readScriptContext } from '../../src/core/scripts/context';
import { compileNpcScenes } from '../../src/core/scripts/npc-compile';
import { blankNpcScene, type NpcScene } from '../../src/core/scripts/npc-scenes';
import { npcSceneFromComment } from '../../src/core/scripts/tag';
import { mysqlUrl } from '../helpers/env';

function opts() {
  const u = new URL(mysqlUrl());
  return { host: u.hostname, port: Number(u.port || 3306), user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password), database: u.pathname.slice(1) };
}

let db: WorldDb;
beforeAll(async () => { db = await openMysqlWorldDb(opts()); });
afterAll(async () => { await db?.close(); });

const NONE = { inserts: {}, deletes: {}, updates: [], flags: [], warnings: [] };
const say = { kind: 'say' as const, text: 'Hello', style: 'say' as const, waitMs: 500 };
const scenesFor = (): NpcScene[] => [
  { ...blankNpcScene('s1'), steps: [say, { ...say, waitMs: 1000 }] },
  { ...blankNpcScene('s2'), trigger: { kind: 'dies' }, steps: [say] },
];

/** An existing NPC as the app reads it */
async function read(entry: number): Promise<CustomNpc> {
  const found = await readExistingRows(db, 'npc', entry);
  if (!found) throw new Error(`NPC ${entry} is not in the database`);
  return npcFromRows(entry, found.rows, { sharedLoot: found.sharedLoot, spawnCount: found.spawnCount, sharedTrainer: found.sharedTrainer, sharedMenus: found.sharedMenus, sharedTexts: found.sharedTexts, databaseScripts: found.databaseScripts });
}

describe('NPC scripts against the real database', () => {
  it("finds no database script that starts with the tool's NPC tag", async () => {
    expect(await db.selectByPrefix!('smart_scripts', 'comment', 'AQC npc')).toEqual([]);
  }, 60_000);

  it('compiles scenes on the NPCs with the most SmartAI rows without colliding with a database key', async (ctx) => {
    const rows = await db.selectRows('smart_scripts', { source_type: '0' });
    const counts = new Map<number, number>();
    for (const r of rows) counts.set(Number(r.entryorguid), (counts.get(Number(r.entryorguid)) ?? 0) + 1);
    const top = [...counts].filter(([entry]) => entry > 0).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([entry]) => entry);
    if (top.length === 0) return ctx.skip();
    const npcs = top.map((entry) => ({ ...newNpc(entry), scenes: scenesFor() }));
    const context = await readScriptContext(db, 0, [], top);
    const out = compileNpcScenes({ npcs, objectives: new Map(), context, taken: NONE });
    const taken = new Set(rows.map((r) => `${r.entryorguid}/${r.source_type}/${r.id}/${r.link}`));
    const lists = await db.selectRows('smart_scripts', { source_type: '9' });
    for (const r of lists) taken.add(`${r.entryorguid}/9/${r.id}/${r.link}`);
    for (const row of out.inserts.smart_scripts ?? []) {
      expect(taken.has(`${row.entryorguid}/${row.source_type}/${row.id}/${row.link}`), `${row.entryorguid}/${row.source_type}/${row.id}`).toBe(false);
    }
    // Nothing the tool wrote is deleted from the database's own rows
    expect(out.deletes.smart_scripts ?? []).toEqual([]);
  }, 120_000);

  it('still reads every database gossip-select script as keeping its option', async (ctx) => {
    const rows = (await db.selectRows('smart_scripts', { source_type: '0', event_type: '62' })).filter((r) => Number(r.entryorguid) > 0).slice(0, 10);
    if (rows.length === 0) return ctx.skip();
    let checked = 0;
    for (const row of rows) {
      const npc = await read(Number(row.entryorguid));
      const option = npc.gossipMenu?.menus.find((m) => m.menuId === Number(row.event_param1))?.options.find((o) => o.optionId === Number(row.event_param2));
      if (!option) continue;
      expect(option.kept, `creature ${row.entryorguid} menu ${row.event_param1} option ${row.event_param2}`).toBe(true);
      checked += 1;
    }
    if (checked === 0) ctx.skip();
  }, 120_000);

  it("gets a scene back from its trigger row's comment", async () => {
    const [entry] = [...new Set((await db.selectRows('creature_template', {})).map((r) => Number(r.entry)))].sort((a, b) => a - b);
    const scenes = scenesFor();
    const context = await readScriptContext(db, 0, [], [entry!]);
    const out = compileNpcScenes({ npcs: [{ ...newNpc(entry!), scenes }], objectives: new Map(), context, taken: NONE });
    const back = (out.inserts.smart_scripts ?? []).flatMap((r) => (npcSceneFromComment(r.comment) ? [npcSceneFromComment(r.comment)!] : []));
    expect(back).toEqual(scenes);
  }, 60_000);
});
