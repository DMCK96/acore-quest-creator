import { describe, it, expect, beforeEach } from 'vitest';
import { createApi, type ApiDeps, type DevDb } from '../../src/main/api';
import { openStore, type SecretBox } from '../../src/main/store/store';
import { forkDb } from '../helpers/fixtures';
import { FakeWorldDb } from '../helpers/fake-world-db';
import type { QuestAggregate } from '@core/model/aggregate';

const box: SecretBox = { encrypt: (s) => Uint8Array.from(Buffer.from(s)), decrypt: (b) => Buffer.from(b).toString() };
const profile = { name: 'w', role: 'world' as const, host: 'h', port: 3306, user: 'u', database: 'd', password: 'p' };
let db: FakeWorldDb; let files: Map<string, string>; let executed: string[][]; let devOpened = 0;

function seed(): FakeWorldDb {
  const d = forkDb();
  d.insert('quest_template', { ID: '60001', LogTitle: 'Wolves', RewardItem1: '25', RewardAmount1: '1' });
  d.insert('creature_queststarter', { id: '100', quest: '60001' });
  d.insert('creature_questender', { id: '100', quest: '60001' });
  d.insert('item_template', { entry: '25', name: 'Worn Shortsword' });
  d.insert('creature_template', { entry: '100', name: 'Marshal', npcflag: '2' });
  return d;
}
function makeApi(overrides: Partial<ApiDeps> = {}) {
  const store = openStore(':memory:', box);
  const dev: DevDb = { execute: async (s) => { executed.push([...s]); }, close: async () => {} };
  const deps: ApiDeps = {
    store, openWorldDb: async () => db, openDevDb: async () => { devOpened++; return dev; },
    fs: { writeFile: async (p, t) => { files.set(p, t); }, ensureDir: async () => {}, listDir: async () => [...files.keys()].map((k) => k.split(/[\\/]/).pop()!) },
    now: () => new Date('2026-09-21T10:00:00Z'), defaultOutputDir: 'C:\\out', ...overrides,
  };
  return { api: createApi(deps), store };
}
beforeEach(() => { db = seed(); files = new Map(); executed = []; devOpened = 0; });
const ok = <T>(r: { ok: boolean; value?: T; error?: any }): T => { if (!r.ok) throw new Error(JSON.stringify(r.error)); return r.value as T; };

async function connected() {
  const { api, store } = makeApi();
  const rec = ok(await api.saveProfile(profile));
  ok(await api.connect(rec.id));
  return { api, store };
}

describe('connection', () => {
  it('refuses quest calls before connecting', async () => {
    const { api } = makeApi();
    expect(await api.searchQuests('x')).toMatchObject({ ok: false, error: { code: 'NOT_CONNECTED' } });
    expect(await api.openQuest(60001)).toMatchObject({ ok: false, error: { code: 'NOT_CONNECTED' } });
  });
  it('reports drift and blocks when an always-emitted table is missing', async () => {
    db.dropTable('quest_offer_reward');
    const { api } = makeApi();
    const rec = ok(await api.saveProfile(profile));
    const s = ok(await api.connect(rec.id));
    expect(s.blocking).toBe(true);
    expect(s.drift.missingTables).toContain('quest_offer_reward');
  });
  it('maps connection failures to CONNECTION', async () => {
    const { api } = makeApi({ openWorldDb: async () => { throw Object.assign(new Error('boom'), { name: 'WorldDbConnectionError' }); } });
    const rec = ok(await api.saveProfile(profile));
    expect(await api.connect(rec.id)).toMatchObject({ ok: false, error: { code: 'CONNECTION' } });
  });
});

describe('quest-giver flag', () => {
  const edited = (r: { aggregate: QuestAggregate }, v: Record<string, any>): QuestAggregate => ({ ...r.aggregate, values: { ...r.aggregate.values, ...v } });
  it('adds the flag to a starter that lacks it, keeps other bits, and says so', async () => {
    db.insert('creature_template', { entry: '300', name: 'Grunt', npcflag: '0' });
    db.insert('creature_template', { entry: '301', name: 'Vendor', npcflag: '128' });
    const { api } = await connected();
    const r = ok(await api.openQuest(60001));
    ok(await api.saveDraft(edited(r, { creature_queststarter: [{ id: 100 }, { id: 300 }, { id: 301 }, { id: 999 }] })));
    const changes = ok(await api.previewChanges(60001));
    expect(changes).toContainEqual({ table: 'creature_template', key: 'entry=300', column: 'npcflag', before: '0', after: '2' });
    expect(changes).toContainEqual({ table: 'creature_template', key: 'entry=301', column: 'npcflag', before: '128', after: '130' });
    expect(changes.some((c: any) => c.key === 'entry=100' || c.key === 'entry=999')).toBe(false);
    const e = ok(await api.exportQuest(60001));
    expect(e.sql).toContain('UPDATE `creature_template` SET `npcflag` = `npcflag` | 2 WHERE `entry` = 300;');
    expect(e.sql).toContain('WHERE `entry` = 301;');
    expect(e.sql).not.toContain('`entry` = 100;');
    expect(e.warnings.filter((w) => w.code === 'QUESTGIVER_FLAG_ADDED')).toHaveLength(2);
  });
  it('includes the flag update when applying to the dev DB', async () => {
    db.insert('creature_template', { entry: '300', name: 'Grunt', npcflag: '0' });
    const { api } = await connected();
    ok(await api.saveProfile({ ...profile, name: 'dev', role: 'dev' }));
    const r = ok(await api.openQuest(60001));
    ok(await api.saveDraft(edited(r, { creature_questender: [{ id: 300 }] })));
    ok(await api.applyToDev(60001, true));
    expect(executed[0].some((s) => s === 'UPDATE `creature_template` SET `npcflag` = `npcflag` | 2 WHERE `entry` = 300;')).toBe(true);
  });
  it('emits nothing for creatures that are already quest givers', async () => {
    const { api } = await connected();
    ok(await api.openQuest(60001));
    const e = ok(await api.exportQuest(60001));
    expect(e.sql).not.toContain('UPDATE `creature_template`');
    expect(e.warnings.some((w) => w.code === 'QUESTGIVER_FLAG_ADDED')).toBe(false);
  });
});

describe('canvas nodes', () => {
  it('refuses node calls before connecting', async () => {
    const { api } = makeApi();
    expect(await api.listNodes()).toMatchObject({ ok: false, error: { code: 'NOT_CONNECTED' } });
    expect(await api.moveNodes([{ questId: 1, x: 0, y: 0 }])).toMatchObject({ ok: false, error: { code: 'NOT_CONNECTED' } });
  });
  it('places a new draft at the requested position, else at the next free slot, and never moves an existing one', async () => {
    db.insert('quest_template', { ID: '60002', LogTitle: 'Second' });
    const { api } = await connected();
    ok(await api.openQuest(60001, { x: 500, y: 250 }));
    ok(await api.openQuest(60002));
    const n1 = ok(await api.newQuest());
    ok(await api.openQuest(60001, { x: 0, y: 0 }));
    const nodes = ok(await api.listNodes());
    const at = (id: number) => nodes.find((n) => n.questId === id)!;
    expect([at(60001).x, at(60001).y]).toEqual([500, 250]);
    expect([at(60002).x, at(60002).y]).toEqual([0, 0]);
    expect([at(n1.questId).x, at(n1.questId).y]).toEqual([320, 0]);
  });
  it('lists nodes with title, level, badges and issue counts', async () => {
    const { api } = await connected();
    const r = ok(await api.openQuest(60001));
    ok(await api.saveDraft({ ...r.aggregate, values: { ...r.aggregate.values, 'quest_template.QuestLevel': 12, creature_questender: [] } }));
    ok(await api.exportQuest(60001));
    const [node] = ok(await api.listNodes());
    expect(node).toMatchObject({ questId: 60001, title: 'Wolves', level: 12, isNew: false, exported: true, unsafe: false });
    expect(node.warnings).toBeGreaterThanOrEqual(1);
    expect(node.errors).toBe(0);
    const fresh = ok(await api.newQuest());
    expect(ok(await api.listNodes()).find((n) => n.questId === fresh.questId)).toMatchObject({ isNew: true, exported: false, title: '' });
  });
  it('moves and removes nodes and persists the viewport', async () => {
    const { api } = await connected();
    ok(await api.openQuest(60001));
    ok(await api.moveNodes([{ questId: 60001, x: 40.5, y: -20 }, { questId: 12345, x: 1, y: 1 }]));
    expect(ok(await api.listNodes())[0]).toMatchObject({ x: 40.5, y: -20 });
    ok(await api.saveViewport({ x: -10, y: 5, zoom: 0.5 }));
    expect(ok(await api.getProject()).viewport).toEqual({ x: -10, y: 5, zoom: 0.5 });
    ok(await api.removeNode(60001));
    ok(await api.removeNode(60001));
    expect(ok(await api.listNodes())).toEqual([]);
  });
});

describe('open / draft', () => {
  it('rejects bad ids and unknown quests', async () => {
    const { api } = await connected();
    for (const bad of [0, -1, 1.5, Number.NaN]) expect(await api.openQuest(bad)).toMatchObject({ ok: false, error: { code: 'INVALID_QUEST_ID' } });
    expect(await api.openQuest(424242)).toMatchObject({ ok: false, error: { code: 'QUEST_NOT_FOUND' } });
  });
  it('opens a quest with fidelity ok and creates a draft', async () => {
    const { api } = await connected();
    const r = ok(await api.openQuest(60001));
    expect(r.fidelity).toEqual({ ok: true });
    expect(r.aggregate.values['quest_template.LogTitle']).toBe('Wolves');
    expect(r.hasDraft).toBe(false);
    expect(ok(await api.openQuest(60001)).hasDraft).toBe(true);
  });
  it('returns the saved draft edits and flags a stale draft when the DB changed underneath', async () => {
    const { api } = await connected();
    const r = ok(await api.openQuest(60001));
    ok(await api.saveDraft({ ...r.aggregate, values: { ...r.aggregate.values, 'quest_template.LogTitle': 'Edited' } }));
    let again = ok(await api.openQuest(60001));
    expect(again.aggregate.values['quest_template.LogTitle']).toBe('Edited');
    expect(again.stale).toBe(false);
    db.update('quest_template', { ID: '60001' }, { LogTitle: 'Changed in DB' });
    again = ok(await api.openQuest(60001));
    expect(again.stale).toBe(true);
    expect(again.aggregate.values['quest_template.LogTitle']).toBe('Edited');
  });
});

describe('search and names', () => {
  it('searches and resolves names', async () => {
    const { api } = await connected();
    expect(ok(await api.searchQuests('wolves'))[0]).toMatchObject({ id: 60001, title: 'Wolves' });
    expect(ok(await api.lookupNames('item', [25, 26]))).toEqual({ 25: 'Worn Shortsword' });
  });
});

describe('new quest', () => {
  it('allocates the next free id in the project range and reserves it via a draft', async () => {
    const { api } = await connected();
    const a = ok(await api.newQuest()); const b = ok(await api.newQuest());
    expect(a.questId).toBe(60000);
    expect(a.aggregate.isNew).toBe(true);
    // 60000 is reserved by the first draft and 60001 already exists in the world DB, so the
    // next free id in the range is 60002: ids are checked against both at assignment.
    expect(b.questId).toBe(60002);
  });
  it('reports a full range', async () => {
    const { api } = await connected();
    ok(await api.updateProject({ ...ok(await api.getProject()), idRangeStart: 60000, idRangeEnd: 60000 }));
    ok(await api.newQuest());
    expect(await api.newQuest()).toMatchObject({ ok: false, error: { code: 'RANGE_EXHAUSTED' } });
  });
});

describe('preview, validate, export', () => {
  const edited = (r: { aggregate: QuestAggregate }, v: Record<string, any>): QuestAggregate => ({ ...r.aggregate, values: { ...r.aggregate.values, ...v } });

  it('previews only the cells the user changed', async () => {
    const { api } = await connected();
    const r = ok(await api.openQuest(60001));
    ok(await api.saveDraft(edited(r, { 'quest_template.LogTitle': 'Edited' })));
    expect(ok(await api.previewChanges(60001))).toEqual([{ table: 'quest_template', key: 'ID=60001', column: 'LogTitle', before: 'Wolves', after: 'Edited' }]);
  });

  it('exports to the project output dir with a dated, slugged file name', async () => {
    const { api } = await connected();
    ok(await api.openQuest(60001));
    const e = ok(await api.exportQuest(60001));
    expect(e.path).toBe('C:\\out\\2026_09_21_00_quest_60001_wolves.sql');
    expect(files.get(e.path)).toBe(e.sql);
    expect(e.sql).toContain('DELETE FROM `quest_template` WHERE `ID` = 60001;');
    const second = ok(await api.exportQuest(60001));
    expect(second.path).toBe('C:\\out\\2026_09_21_01_quest_60001_wolves.sql');
  });

  it('blocks export on validation errors and returns the issues', async () => {
    const { api } = await connected();
    const r = ok(await api.openQuest(60001));
    ok(await api.saveDraft(edited(r, { 'quest_template.LogTitle': '' })));
    const e = await api.exportQuest(60001);
    expect(e).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect((e as any).error.issues.map((i: any) => i.code)).toContain('NO_TITLE');
    expect(files.size).toBe(0);
  });

  it('blocks export when the quest failed the fidelity gate on open', async () => {
    const { api, store } = await connected();
    ok(await api.openQuest(60001));
    const project = store.projects.ensureDefault('C:\\out');
    const d = store.drafts.get(project.id, 60001)!;
    store.drafts.save({ projectId: project.id, questId: 60001, isNew: false, aggregate: d.aggregate, snapshot: d.snapshot,
      fidelity: { ok: false, differences: [{ table: 'quest_template', key: 'ID=60001', column: 'LogTitle', before: 'a', after: 'b' }] } });
    expect(await api.exportQuest(60001)).toMatchObject({ ok: false, error: { code: 'FIDELITY' } });
  });

  it('blocks a new quest whose id was taken in the world DB after assignment', async () => {
    const { api } = await connected();
    const n = ok(await api.newQuest());
    ok(await api.saveDraft({ ...n.aggregate, values: { ...n.aggregate.values, 'quest_template.LogTitle': 'Fresh', creature_queststarter: [{ id: 100 }], creature_questender: [{ id: 100 }] } }));
    db.insert('quest_template', { ID: String(n.questId) });
    expect(await api.exportQuest(n.questId)).toMatchObject({ ok: false, error: { code: 'ID_COLLISION' } });
  });
});

describe('apply to dev DB', () => {
  it('requires confirmation and a dev profile', async () => {
    const { api } = await connected();
    ok(await api.openQuest(60001));
    expect(await api.applyToDev(60001, false)).toMatchObject({ ok: false, error: { code: 'CONFIRMATION_REQUIRED' } });
    expect(await api.applyToDev(60001, true)).toMatchObject({ ok: false, error: { code: 'NO_DEV_PROFILE' } });
    expect(devOpened).toBe(0);
  });
  it('executes the patch statements through the dev connection', async () => {
    const { api } = await connected();
    ok(await api.saveProfile({ ...profile, name: 'dev', role: 'dev' }));
    ok(await api.openQuest(60001));
    const r = ok(await api.applyToDev(60001, true));
    expect(r.statements).toBeGreaterThan(0);
    expect(executed).toHaveLength(1);
    expect(executed[0].some((s) => s.startsWith('INSERT INTO `quest_template`'))).toBe(true);
    expect(executed[0].length).toBe(r.statements);
  });
});
