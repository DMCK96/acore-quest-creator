import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { openMysqlWorldDb } from '@core/db/mysql-world-db';
import type { WorldDb } from '@core/db/world-db';
import { existingStatements } from '../../src/core/entities/existing';
import { npcFromRows } from '../../src/core/entities/from-rows';
import { EMPTY_ENTITIES, type CustomNpc } from '../../src/core/entities/model';
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

const TRAINER_TABLES = ['creature_default_trainer', 'trainer', 'trainer_spell'];

/** An existing NPC as the app reads it */
async function read(entry: number): Promise<CustomNpc> {
  const found = await readExistingRows(db, 'npc', entry);
  if (!found) throw new Error(`NPC ${entry} is not in the database`);
  return npcFromRows(entry, found.rows, { sharedLoot: found.sharedLoot, spawnCount: found.spawnCount, sharedTrainer: found.sharedTrainer });
}

const statementsOf = (npc: CustomNpc) => existingStatements({ ...EMPTY_ENTITIES, npcs: [npc] }, []);
const trainerStatements = (npc: CustomNpc) => statementsOf(npc).apply.filter((s) => TRAINER_TABLES.includes(s.table));
const flagOf = (npc: CustomNpc): number => {
  const insert = statementsOf(npc).apply.find((s) => s.table === 'creature_template' && s.kind === 'insert') as { row: Record<string, string> };
  return Number(insert.row.npcflag);
};

/** Which NPCs use which trainer, and what each trainer is */
async function trainerFacts() {
  const links = await db.selectRows('creature_default_trainer', {});
  const trainers = new Map((await db.selectRows('trainer', {})).map((t) => [Number(t.Id), t]));
  const users = new Map<number, number[]>();
  for (const l of links) users.set(Number(l.TrainerId), [...(users.get(Number(l.TrainerId)) ?? []), Number(l.CreatureId)]);
  const entries = new Set((await db.selectRows('creature_template', {})).map((r) => Number(r.entry)));
  /** The first NPC (with a creature template) of a trainer that matches */
  const firstNpc = (pick: (id: number, type: number, requirement: number, npcs: number[]) => boolean): { entry: number; trainerId: number; npcs: number[] } | null => {
    for (const [id, t] of trainers) {
      const npcs = (users.get(id) ?? []).filter((e) => entries.has(e));
      if (npcs.length > 0 && pick(id, Number(t.Type), Number(t.Requirement), npcs)) return { entry: npcs[0]!, trainerId: id, npcs };
    }
    return null;
  };
  return { firstNpc, trainers };
}

describe('reading trainers from the real database', () => {
  it('reads a class trainer with its class, its spells and the NPCs sharing it', async (ctx) => {
    const { firstNpc } = await trainerFacts();
    const found = firstNpc((_, type, requirement, npcs) => type === 0 && requirement > 0 && npcs.length > 1);
    if (!found) return ctx.skip();
    const npc = await read(found.entry);
    expect(npc.trainer).toMatchObject({ trainerId: found.trainerId, type: 'class' });
    expect(npc.trainer!.requirement).toBeGreaterThan(0);
    expect(npc.trainer!.spells.length).toBeGreaterThan(0);
    expect(npc.origin).toMatchObject({ kind: 'existing', sharedTrainer: found.npcs.length - 1, locked: expect.arrayContaining(['trainer']) });
  });

  it('reads a profession trainer with no class', async (ctx) => {
    const { firstNpc } = await trainerFacts();
    const found = firstNpc((_, type) => type === 2);
    if (!found) return ctx.skip();
    const npc = await read(found.entry);
    expect(npc.trainer).toMatchObject({ type: 'profession', requirement: 0 });
  });

  it('keeps the older npc_trainer rows an NPC has, to say what else it teaches', async (ctx) => {
    const rows = await db.selectRows('npc_trainer', {});
    const entries = new Set((await db.selectRows('creature_template', {})).map((r) => Number(r.entry)));
    const owner = rows.map((r) => Number(r.ID)).find((id) => entries.has(id));
    if (owner === undefined) return ctx.skip();
    const npc = await read(owner);
    expect(npc.origin.kind === 'existing' && (npc.origin.original.npc_trainer ?? []).length).toBeGreaterThan(0);
  });

  it('writes nothing for trainers it only read, and leaves npcflag as the row has it', async (ctx) => {
    const { firstNpc } = await trainerFacts();
    const picks = [
      firstNpc((_, type, requirement, npcs) => type === 0 && requirement > 0 && npcs.length > 1),
      firstNpc((_, type, __, npcs) => type === 0 && npcs.length === 1),
      firstNpc((_, type) => type === 2),
      firstNpc((_, type) => type === 1),
    ];
    let checked = 0;
    for (const found of picks) {
      if (!found) continue;
      checked++;
      const npc = await read(found.entry);
      const row = (await db.selectRows('creature_template', { entry: String(found.entry) }))[0]!;
      expect(trainerStatements(npc), `NPC ${found.entry}`).toEqual([]);
      expect(flagOf(npc), `NPC ${found.entry}`).toBe(Number(row.npcflag));
    }
    if (checked === 0) ctx.skip();
  });

  it('gives a shared trainer\'s NPC its own copy: new rows under a new id, the shared trainer in no key', async (ctx) => {
    const { firstNpc } = await trainerFacts();
    const found = firstNpc((_, type, requirement, npcs) => type === 0 && requirement > 0 && npcs.length > 1);
    if (!found) return ctx.skip();
    const npc = await read(found.entry);
    const next = ((await db.selectMax?.('trainer', 'Id')) ?? 0) + 1;
    const copy: CustomNpc = { ...npc, trainer: { ...npc.trainer!, trainerId: next }, origin: { ...npc.origin, locked: [] } as CustomNpc['origin'] };
    const out = statementsOf(copy);
    const written = [...out.apply, ...out.revert].filter((s) => s.table === 'trainer' || s.table === 'trainer_spell');
    expect(written.length).toBeGreaterThan(0);
    for (const s of written) {
      const id = s.kind === 'insert' ? (s.row.Id ?? s.row.TrainerId) : s.kind === 'delete' ? (s.key.Id ?? s.key.TrainerId) : undefined;
      expect(id, `${s.kind} ${s.table}`).toBe(String(next));
    }
    expect(out.apply).toContainEqual({ kind: 'insert', table: 'creature_default_trainer', row: expect.objectContaining({ CreatureId: String(found.entry), TrainerId: String(next) }) });
  });

  it('reads every trainer in the database and writes nothing for any of them', async () => {
    const { firstNpc, trainers } = await trainerFacts();
    let checked = 0;
    for (const id of trainers.keys()) {
      const found = firstNpc((trainerId) => trainerId === id);
      if (!found) continue;
      const npc = await read(found.entry);
      const row = (await db.selectRows('creature_template', { entry: String(found.entry) }))[0]!;
      expect(trainerStatements(npc), `trainer ${id}, NPC ${found.entry}`).toEqual([]);
      expect(flagOf(npc), `trainer ${id}, NPC ${found.entry}`).toBe(Number(row.npcflag));
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  }, 120_000);

  it('renders the rows of a new trainer against the real columns, so the export cannot fail on one it lacks', async (ctx) => {
    const { firstNpc } = await trainerFacts();
    const found = firstNpc((_, type, requirement, npcs) => type === 0 && requirement > 0 && npcs.length > 1);
    if (!found) return ctx.skip();
    const npc = await read(found.entry);
    const next = ((await db.selectMax?.('trainer', 'Id')) ?? 0) + 1;
    const copy: CustomNpc = { ...npc, trainer: { ...npc.trainer!, trainerId: next }, origin: { ...npc.origin, locked: [] } as CustomNpc['origin'] };
    const schema = await loadSchema(db, TRAINER_TABLES);
    const inserts = statementsOf(copy).apply.filter((st) => TRAINER_TABLES.includes(st.table) && st.kind === 'insert');
    expect(inserts.length).toBeGreaterThan(2);
    for (const st of inserts) {
      if (st.kind !== 'insert') continue;
      const row = { ...defaultColumnValues(st.table, schema), ...st.row };
      expect(() => renderInsert(st.table, schema.tables[st.table]!, row), st.table).not.toThrow();
    }
  });
});
