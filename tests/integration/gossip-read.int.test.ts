import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { openMysqlWorldDb } from '@core/db/mysql-world-db';
import type { WorldDb } from '@core/db/world-db';
import { existingStatements } from '../../src/core/entities/existing';
import { npcFromRows } from '../../src/core/entities/from-rows';
import { copyMenus } from '../../src/core/entities/gossip-tree';
import { EMPTY_ENTITIES, type CustomNpc } from '../../src/core/entities/model';
import { serviceOf } from '../../src/core/game/gossip-services';
import { readExistingRows } from '../../src/main/entities/existing';
import { defaultColumnValues } from '../../src/core/import/importer';
import { renderInsert } from '../../src/core/sql/render';
import { loadSchema } from '../../src/core/schema/load';
import { mysqlUrl } from '../helpers/env';

function opts() {
  const u = new URL(mysqlUrl());
  return { host: u.hostname, port: Number(u.port || 3306), user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password), database: u.pathname.slice(1) };
}

let db: WorldDb;
beforeAll(async () => { db = await openMysqlWorldDb(opts()); });
afterAll(async () => { await db?.close(); });

const GOSSIP_TABLES = ['gossip_menu', 'gossip_menu_option', 'npc_text'];

/** An existing NPC as the app reads it */
async function read(entry: number): Promise<CustomNpc> {
  const found = await readExistingRows(db, 'npc', entry);
  if (!found) throw new Error(`NPC ${entry} is not in the database`);
  return npcFromRows(entry, found.rows, { sharedLoot: found.sharedLoot, spawnCount: found.spawnCount, sharedTrainer: found.sharedTrainer, sharedMenus: found.sharedMenus, sharedTexts: found.sharedTexts });
}

const statementsOf = (npc: CustomNpc) => existingStatements({ ...EMPTY_ENTITIES, npcs: [npc] }, []);
const gossipStatements = (npc: CustomNpc) => statementsOf(npc).apply.filter((s) => GOSSIP_TABLES.includes(s.table));
const rowOf = (npc: CustomNpc): Record<string, string> => (statementsOf(npc).apply.find((s) => s.table === 'creature_template' && s.kind === 'insert') as { row: Record<string, string> }).row;

/** The first creature of each menu, for the sweep, and the facts the targeted cases pick from */
async function facts() {
  const templates = (await db.selectRows('creature_template', {})).filter((r) => Number(r.gossip_menu_id ?? 0) > 0);
  const options = await db.selectRows('gossip_menu_option', {});
  const firstByMenu = new Map<number, number>();
  for (const t of templates) if (!firstByMenu.has(Number(t.gossip_menu_id))) firstByMenu.set(Number(t.gossip_menu_id), Number(t.entry));
  const users = new Map<number, number>();
  for (const t of templates) users.set(Number(t.gossip_menu_id), (users.get(Number(t.gossip_menu_id)) ?? 0) + 1);
  return { templates, options, firstByMenu, users };
}

describe('reading gossip from the real database', () => {
  it('reads a tree of several menus, following the options that open them', async (ctx) => {
    const { options, firstByMenu } = await facts();
    const opens = options.find((o) => Number(o.ActionMenuID) > 0 && firstByMenu.has(Number(o.MenuID)) && Number(o.ActionMenuID) !== Number(o.MenuID));
    if (!opens) return ctx.skip();
    const npc = await read(firstByMenu.get(Number(opens.MenuID))!);
    expect(npc.gossipMenu!.menus.length).toBeGreaterThan(1);
    const loaded = new Set(npc.gossipMenu!.menus.map((m) => m.menuId));
    for (const m of npc.gossipMenu!.menus) {
      for (const o of m.options) if (o.action.kind === 'menu') expect(loaded.has(o.action.menuId) || npc.gossipMenu!.menus.length === 24, `menu ${o.action.menuId} of ${m.menuId}`).toBe(true);
    }
  }, 60_000);

  it('locks a menu several creatures use, and a menu only a locked menu opens', async (ctx) => {
    const { users, firstByMenu, options } = await facts();
    const shared = [...users].find(([menu, n]) => n > 1 && firstByMenu.has(menu));
    if (!shared) return ctx.skip();
    const npc = await read(firstByMenu.get(shared[0])!);
    expect(npc.gossipMenu!.menus[0]).toMatchObject({ menuId: shared[0], locked: true });
    expect(npc.origin.kind === 'existing' && npc.origin.sharedMenus?.[String(shared[0])]).toBe(shared[1] - 1);
    const children = options.filter((o) => Number(o.MenuID) === shared[0] && Number(o.ActionMenuID) > 0).map((o) => Number(o.ActionMenuID));
    for (const m of npc.gossipMenu!.menus.filter((x) => children.includes(x.menuId))) expect(m.locked).toBe(true);
  }, 60_000);

  it('reads an option a condition names, and one a gossip-select script names, as kept', async (ctx) => {
    const { firstByMenu } = await facts();
    const conditions = (await db.selectRows('conditions', { SourceTypeOrReferenceId: '15' })).find((c) => firstByMenu.has(Number(c.SourceGroup)));
    const scripts = (await db.selectRows('smart_scripts', { source_type: '0', event_type: '62' })).find((s) => firstByMenu.has(Number(s.event_param1)));
    if (!conditions || !scripts) return ctx.skip();
    const tied = await read(firstByMenu.get(Number(conditions.SourceGroup))!);
    expect(tied.gossipMenu!.menus.find((m) => m.menuId === Number(conditions.SourceGroup))!.options.find((o) => o.optionId === Number(conditions.SourceEntry))!.kept).toBe(true);
    const scripted = await read(firstByMenu.get(Number(scripts.event_param1))!);
    expect(scripted.gossipMenu!.menus.find((m) => m.menuId === Number(scripts.event_param1))!.options.find((o) => o.optionId === Number(scripts.event_param2))!.kept).toBe(true);
  }, 60_000);

  it('reads the vendor and trainer options as the named services', async (ctx) => {
    const { options, firstByMenu } = await facts();
    for (const [type, flag] of [[3, 128], [5, 16]] as const) {
      const found = options.find((o) => Number(o.OptionType) === type && Number(o.OptionNpcFlag) === flag && Number(o.ActionMenuID) === 0 && firstByMenu.has(Number(o.MenuID)));
      if (!found) return ctx.skip();
      const npc = await read(firstByMenu.get(Number(found.MenuID))!);
      const option = npc.gossipMenu!.menus.find((m) => m.menuId === Number(found.MenuID))!.options.find((o) => o.optionId === Number(found.OptionID))!;
      expect(option.action).toEqual({ kind: 'service', type, npcFlag: flag });
      expect(serviceOf(type, flag)).toBeDefined();
    }
  }, 60_000);

  it('reads every creature menu in the database and writes nothing for any of them', async () => {
    const { firstByMenu } = await facts();
    let checked = 0;
    for (const [menu, entry] of firstByMenu) {
      const npc = await read(entry);
      const row = (await db.selectRows('creature_template', { entry: String(entry) }))[0]!;
      expect(gossipStatements(npc), `menu ${menu}, NPC ${entry}`).toEqual([]);
      const written = rowOf(npc);
      expect(Number(written.npcflag), `menu ${menu}, NPC ${entry}`).toBe(Number(row.npcflag));
      expect(Number(written.gossip_menu_id ?? row.gossip_menu_id), `menu ${menu}, NPC ${entry}`).toBe(Number(row.gossip_menu_id));
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  }, 900_000);

  it('renders a copy of a shared tree under fresh ids against the real columns, naming none of the ids it was read with', async (ctx) => {
    const { users, firstByMenu } = await facts();
    const shared = [...users].find(([menu, n]) => n > 1 && firstByMenu.has(menu));
    if (!shared) return ctx.skip();
    const npc = await read(firstByMenu.get(shared[0])!);
    const tree = npc.gossipMenu!;
    const locked = tree.menus.filter((m) => m.locked).map((m) => m.menuId);
    const nextMenu = ((await db.selectMax?.('gossip_menu', 'MenuID')) ?? 0) + 1;
    const nextText = ((await db.selectMax?.('npc_text', 'ID', 16_000_000)) ?? 0) + 1;
    const copy: CustomNpc = { ...npc, gossipMenu: copyMenus(tree, locked, locked.map((_, i) => ({ menu: nextMenu + i, text: nextText + i }))) };
    const out = statementsOf(copy);
    const readMenus = new Set(tree.menus.map((m) => String(m.menuId)));
    const readTexts = new Set(tree.menus.map((m) => String(m.textId)));
    for (const s of [...out.apply, ...out.revert]) {
      if (!GOSSIP_TABLES.includes(s.table)) continue;
      const key = s.kind === 'insert' ? s.row : s.key;
      if (s.table !== 'npc_text') expect(readMenus.has(key.MenuID ?? ''), `${s.kind} ${s.table}`).toBe(false);
      else expect(readTexts.has(key.ID ?? ''), `${s.kind} ${s.table}`).toBe(false);
    }
    const schema = await loadSchema(db, GOSSIP_TABLES);
    const inserts = out.apply.filter((s) => GOSSIP_TABLES.includes(s.table) && s.kind === 'insert');
    expect(inserts.length).toBeGreaterThan(2);
    for (const st of inserts) {
      if (st.kind !== 'insert') continue;
      const row = { ...defaultColumnValues(st.table, schema), ...st.row };
      expect(() => renderInsert(st.table, schema.tables[st.table]!, row), st.table).not.toThrow();
    }
    expect(rowOf(copy).gossip_menu_id).toBe(String(nextMenu));
  }, 60_000);
});
