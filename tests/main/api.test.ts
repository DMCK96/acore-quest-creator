import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createApi, type ApiDeps, type DevDb } from '../../src/main/api';
import { openStore, type SecretBox } from '../../src/main/store/store';
import { forkDb } from '../helpers/fixtures';
import { FakeWorldDb } from '../helpers/fake-world-db';
import type { QuestAggregate } from '@core/model/aggregate';

const gate = vi.hoisted(() => ({ throwWith: null as Error | null }));
vi.mock('../../src/core/roundtrip/verify', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/roundtrip/verify')>();
  return { ...actual, verifyRoundTrip: (...a: Parameters<typeof actual.verifyRoundTrip>) => { if (gate.throwWith) throw gate.throwWith; return actual.verifyRoundTrip(...a); } };
});

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
beforeEach(() => { gate.throwWith = null; db = seed(); files = new Map(); executed = []; devOpened = 0; });
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
  it('tells a forbidden table apart from a missing one, and never calls a grant problem a connection problem', async () => {
    db.forbidTable('quest_poi');
    db.dropTable('quest_mail_sender');
    const { api } = makeApi();
    const rec = ok(await api.saveProfile(profile));
    const s = ok(await api.connect(rec.id));
    expect(s.drift.forbiddenTables).toEqual(['quest_poi']);
    expect(s.drift.missingTables).toEqual(expect.arrayContaining(['quest_poi', 'quest_mail_sender']));
    expect(s.blocking).toBe(false);
  });
  it('refuses with PERMISSION, not BLOCKING_DRIFT, when a required table is merely unreadable', async () => {
    db.forbidTable('quest_offer_reward');
    const { api } = makeApi();
    const rec = ok(await api.saveProfile(profile));
    expect(ok(await api.connect(rec.id)).blocking).toBe(true);
    const r = await api.openQuest(60001);
    expect(r).toMatchObject({ ok: false, error: { code: 'PERMISSION' } });
    expect((r as any).error.message).toMatch(/may not read.*quest_offer_reward|quest_offer_reward.*may not read/);
  });
  it('maps a missing grant on a query to PERMISSION and any other query failure to QUERY', async () => {
    const boom = (name: string) => async () => ({
      columns: async () => [],
      selectRows: async () => { throw Object.assign(new Error('nope'), { name }); },
      searchQuests: async () => { throw Object.assign(new Error('nope'), { name }); },
      lookupNames: async () => new Map(), existingIds: async () => new Set(), questIdsInRange: async () => [], close: async () => {},
    }) as any;
    for (const [name, code] of [['WorldDbPermissionError', 'PERMISSION'], ['WorldDbQueryError', 'QUERY']] as const) {
      const { api } = makeApi({ openWorldDb: boom(name) });
      const rec = ok(await api.saveProfile(profile));
      ok(await api.connect(rec.id));
      expect(await api.searchQuests('x'), name).toMatchObject({ ok: false, error: { code } });
    }
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

describe('addQuestChain', () => {
  it('imports every quest of the chain, laid out left to right, and opens the one picked', async () => {
    db.insert('quest_template', { ID: '60002', LogTitle: 'More wolves' });
    db.insert('quest_template', { ID: '60003', LogTitle: 'Wolf king' });
    db.insert('quest_template_addon', { ID: '60002', PrevQuestID: '60001' });
    db.insert('quest_template_addon', { ID: '60003', PrevQuestID: '60002' });
    const { api } = await connected();
    const r = ok(await api.addQuestChain(60002, { x: 500, y: 500 }));
    expect(r.open.questId).toBe(60002);
    expect(r.questIds.slice().sort()).toEqual([60001, 60002, 60003]);
    expect(r.truncated).toBe(false);
    const nodes = ok(await api.listNodes());
    const at = (id: number) => nodes.find((n) => n.questId === id)!;
    expect(nodes).toHaveLength(3);
    expect(at(60002)).toMatchObject({ x: 500, y: 500 });
    expect(at(60001).x).toBeLessThan(500);
    expect(at(60003).x).toBeGreaterThan(500);
  });
  it('leaves quests already on the canvas where they are', async () => {
    db.insert('quest_template', { ID: '60002', LogTitle: 'More wolves' });
    db.insert('quest_template_addon', { ID: '60002', PrevQuestID: '60001' });
    const { api } = await connected();
    ok(await api.openQuest(60001, { x: -900, y: -900 }));
    ok(await api.addQuestChain(60002));
    const nodes = ok(await api.listNodes());
    expect(nodes).toHaveLength(2);
    expect(nodes.find((n) => n.questId === 60001)).toMatchObject({ x: -900, y: -900 });
  });
  it('fails like openQuest for a quest that does not exist, adding nothing', async () => {
    const { api } = await connected();
    expect(await api.addQuestChain(70000)).toMatchObject({ ok: false, error: { code: 'QUEST_NOT_FOUND' } });
    expect(ok(await api.listNodes())).toHaveLength(0);
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

describe('linked rows another quest owns', () => {
  const edited = (r: { aggregate: QuestAggregate }, v: Record<string, any>): QuestAggregate => ({ ...r.aggregate, values: { ...r.aggregate.values, ...v } });

  it('exports a new drop source without deleting the questitem row a different quest holds', async () => {
    db.update('quest_template', { ID: '60001' }, { RequiredItemId1: '2000', RequiredItemCount1: '1' });
    db.insert('item_template', { entry: '2000', name: 'Wolf Pelt' });
    // Creature 500 already shows a different quest's item in slot 0.
    db.insert('creature_questitem', { CreatureEntry: '500', Idx: '0', ItemId: '9999' });
    const { api } = await connected();
    const r = ok(await api.openQuest(60001));
    // Exactly what the drops UI produces: slot 0, because it cannot see the row that is there.
    ok(await api.saveDraft(edited(r, {
      creature_loot_template: [{ Entry: 500, Item: 2000, Reference: 0, Chance: 100, QuestRequired: 1, LootMode: 1, GroupId: 0, MinCount: 1, MaxCount: 1, Comment: null }],
      creature_questitem: [{ CreatureEntry: 500, Idx: 0, ItemId: 2000, VerifiedBuild: 0 }],
    })));

    const e = ok(await api.exportQuest(60001));
    expect(e.sql).not.toContain('DELETE FROM `creature_questitem` WHERE `CreatureEntry` = 500 AND `Idx` = 0;');
    expect(e.sql).toContain('DELETE FROM `creature_questitem` WHERE `CreatureEntry` = 500 AND `Idx` = 1;');
    expect(e.warnings.map((w) => w.code)).toContain('LINKED_ROW_COLLISION');

    // And the dev-DB apply runs the same statements, so the other quest survives there too.
    ok(await api.saveProfile({ ...profile, name: 'dev', role: 'dev' }));
    ok(await api.applyToDev(60001, true));
    expect(executed[0].some((s) => s.includes('`creature_questitem`') && s.includes('`Idx` = 0'))).toBe(false);
  });

  it('warns rather than silently turning an ordinary drop into a quest drop', async () => {
    db.update('quest_template', { ID: '60001' }, { RequiredItemId1: '2000', RequiredItemCount1: '1' });
    db.insert('creature_loot_template', { Entry: '600', Item: '2000', Chance: '4', QuestRequired: '0', Comment: 'normal drop' });
    const { api } = await connected();
    const r = ok(await api.openQuest(60001));
    ok(await api.saveDraft(edited(r, {
      creature_loot_template: [{ Entry: 600, Item: 2000, Reference: 0, Chance: 100, QuestRequired: 1, LootMode: 1, GroupId: 0, MinCount: 1, MaxCount: 1, Comment: null }],
    })));
    const e = ok(await api.exportQuest(60001));
    const w = e.warnings.find((x) => x.code === 'LINKED_ROW_COLLISION');
    expect(w, 'the user must be told the row was already there').toBeDefined();
    expect(w!.message).toContain('normal drop');
  });
});

describe('locale rows', () => {
  it('reports the quest\'s locales and the imported English text so the UI can warn about translations', async () => {
    db.insert('quest_template_locale', { ID: '60001', locale: 'frFR', Title: 'Loups' });
    db.insert('quest_template_locale', { ID: '60001', locale: 'deDE', Title: 'Wölfe' });
    db.insert('quest_offer_reward', { ID: '60001', RewardText: 'Well done.' });
    const { api } = await connected();
    const r = ok(await api.openQuest(60001));
    expect(r.locales).toEqual(['deDE', 'frFR']);
    expect(r.importedText['quest_template.LogTitle']).toBe('Wolves');
    expect(r.importedText['quest_offer_reward.RewardText']).toBe('Well done.');
    // Numeric and non-translatable fields stay out of it.
    expect(r.importedText['quest_template.QuestLevel']).toBeUndefined();
    // Reopening onto the existing draft answers from the fresh rows, not the draft.
    expect(ok(await api.openQuest(60001)).locales).toEqual(['deDE', 'frFR']);
  });
  it('reports no locales for a quest that has none, and none for a brand new quest', async () => {
    const { api } = await connected();
    expect(ok(await api.openQuest(60001)).locales).toEqual([]);
    expect(ok(await api.newQuest()).locales).toEqual([]);
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
  // A brand-new quest has no row in the world DB yet, so reopening it (e.g. after closing the
  // editor) must not go through the importer, which would fail with QUEST_NOT_FOUND.
  it('reopens a never-exported quest from its draft, without importing it', async () => {
    const { api } = await connected();
    const created = ok(await api.newQuest());
    const reopened = ok(await api.openQuest(created.questId));
    expect(reopened).toMatchObject({ questId: created.questId, hasDraft: true, stale: false, locales: [] });
    expect(reopened.aggregate).toEqual(created.aggregate);
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

describe('fidelity report freshness', () => {
  it('re-stores the freshly computed report on the draft, so the export gate and the UI agree', async () => {
    const { api, store } = await connected();
    ok(await api.openQuest(60001));
    const project = store.projects.ensureDefault('C:\\out');
    expect(store.drafts.get(project.id, 60001)!.fidelity).toEqual({ ok: true });

    // The world moves under the draft: the next open recomputes the gate from fresh rows.
    gate.throwWith = new Error('patch failed to apply');
    const again = ok(await api.openQuest(60001));
    expect(again.hasDraft).toBe(true);
    expect(again.fidelity.ok).toBe(false);
    expect(store.drafts.get(project.id, 60001)!.fidelity).toEqual(again.fidelity);
    // The gate reads the draft, so it must refuse now that the UI says unsafe.
    expect(await api.exportQuest(60001)).toMatchObject({ ok: false, error: { code: 'FIDELITY' } });
  });

  it('keeps the draft aggregate, snapshot and position untouched while refreshing the report', async () => {
    const { api, store } = await connected();
    const r = ok(await api.openQuest(60001, { x: 77, y: 88 }));
    ok(await api.saveDraft({ ...r.aggregate, values: { ...r.aggregate.values, 'quest_template.LogTitle': 'Edited' } }));
    gate.throwWith = new Error('patch failed to apply');
    ok(await api.openQuest(60001));
    const d = store.drafts.get(store.projects.ensureDefault('C:\\out').id, 60001)!;
    expect(d.aggregate.values['quest_template.LogTitle']).toBe('Edited');
    expect([d.x, d.y]).toEqual([77, 88]);
    expect(d.snapshot).not.toBeNull();
  });
});

describe('round-trip gate throws', () => {
  it('opens the quest as unsafe, stores that fidelity and refuses export', async () => {
    const { api, store } = await connected();
    gate.throwWith = new Error('patch failed to apply');
    const expected = { ok: false, differences: [{ table: '(patch)', key: 'patch failed to apply', column: null, before: undefined, after: undefined }] };
    const r = ok(await api.openQuest(60001));
    expect(r.fidelity).toEqual(expected);
    const d = store.drafts.get(store.projects.ensureDefault('C:\out').id, 60001)!;
    expect(d.fidelity).toEqual(expected);
    expect(await api.exportQuest(60001)).toMatchObject({ ok: false, error: { code: 'FIDELITY' } });
  });
});

describe('blocking drift', () => {
  it('refuses open, new, export and apply with a message naming the missing table', async () => {
    const { api } = await connected();
    ok(await api.saveProfile({ ...profile, name: 'dev', role: 'dev' }));
    ok(await api.openQuest(60001));
    const { api: bad } = makeApi();
    db.dropTable('quest_offer_reward');
    ok(await bad.connect(ok(await bad.saveProfile(profile)).id));
    const results = [await bad.openQuest(60001), await bad.newQuest(), await bad.exportQuest(60001), await bad.applyToDev(60001, true)];
    for (const r of results) {
      expect(r).toMatchObject({ ok: false, error: { code: 'BLOCKING_DRIFT' } });
      expect((r as any).error.message).toContain('quest_offer_reward');
    }
  });
});

describe('profiles and testConnection', () => {
  it('lists saved profiles without passwords', async () => {
    const { api } = makeApi();
    ok(await api.saveProfile(profile));
    const list = ok(await api.listProfiles());
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'w', role: 'world', host: 'h' });
    expect(JSON.stringify(list)).not.toContain('"password"');
  });
  it('testConnection closes the db it opened and persists nothing', async () => {
    let closed = 0;
    const { api } = makeApi({ openWorldDb: async () => ({ close: async () => { closed++; } }) as any });
    expect(await api.testConnection(profile)).toEqual({ ok: true, value: { ok: true } });
    expect(closed).toBe(1);
    expect(ok(await api.listProfiles())).toEqual([]);
  });
  it('testConnection maps WorldDbConnectionError to CONNECTION', async () => {
    const { api } = makeApi({ openWorldDb: async () => { throw Object.assign(new Error('nope'), { name: 'WorldDbConnectionError' }); } });
    expect(await api.testConnection(profile)).toMatchObject({ ok: false, error: { code: 'CONNECTION' } });
    expect(ok(await api.listProfiles())).toEqual([]);
  });
});

describe('links', () => {
  it('reports links between canvas quests, their start badges and nothing disconnected', async () => {
    db.insert('quest_template', { ID: '60002', LogTitle: 'More wolves' });
    db.insert('quest_template_addon', { ID: '60002', PrevQuestID: '60001' });
    const { api } = await connected();
    ok(await api.addQuestChain(60001));
    const nodes = ok(await api.listNodes());
    const first = nodes.find((n) => n.questId === 60001)!;
    const second = nodes.find((n) => n.questId === 60002)!;
    expect(first.links).toEqual([{ to: 60002, component: 'unlock.afterTurnIn', owner: 60002 }]);
    expect(first.starts).toEqual(['npc']);
    expect(second.starts).toEqual(['backend']);
    expect(nodes.every((n) => !n.notConnected)).toBe(true);
  });
  it('follows the draft, not the world, once the link is cleared in the editor', async () => {
    db.insert('quest_template', { ID: '60002', LogTitle: 'More wolves' });
    db.insert('quest_template_addon', { ID: '60002', PrevQuestID: '60001' });
    const { api } = await connected();
    ok(await api.addQuestChain(60001));
    const open = ok(await api.openQuest(60002));
    ok(await api.saveDraft({ ...open.aggregate, values: { ...open.aggregate.values, 'quest_template_addon.PrevQuestID': 0 } }));
    const nodes = ok(await api.listNodes());
    expect(nodes.find((n) => n.questId === 60001)!.links).toEqual([]);
    expect(nodes.filter((n) => n.notConnected).map((n) => n.questId).sort()).toEqual([60001, 60002]);
    expect(nodes.find((n) => n.questId === 60002)!.warnings).toBeGreaterThanOrEqual(1);
  });
  it('counts linked quests that exist but are not on the canvas, and ignores ones that do not exist', async () => {
    db.insert('quest_template', { ID: '60002', LogTitle: 'More wolves' });
    db.insert('quest_template_addon', { ID: '60002', PrevQuestID: '60001' });
    db.insert('quest_template_addon', { ID: '60001', NextQuestID: '70000' }); // 70000 does not exist
    const { api } = await connected();
    ok(await api.openQuest(60001));
    const [node] = ok(await api.listNodes());
    expect(node.offCanvasLinks).toBe(1);
    expect(node.notConnected).toBe(false); // alone on the canvas
  });
  it('shows a script start instead of warning that nothing starts the quest', async () => {
    db.insert('smart_scripts', { entryorguid: '100', source_type: '0', id: '0', link: '0', event_type: '64', action_type: '7', action_param1: '60001', comment: '' });
    const { api } = await connected();
    const open = ok(await api.openQuest(60001));
    expect(open.issues.map((i) => i.code)).not.toContain('NO_STARTER');
    const links = ok(await api.questLinks([60001]));
    expect(links.instances.map((i) => i.summary)).toEqual(expect.arrayContaining([
      'Offered by Marshal (100)', 'Offered by a script on Marshal (100) when the player talks to it',
    ]));
    expect(links.instances.find((i) => i.component === 'start.smartai')!.label).toBe('Offered by a SmartAI script');
    expect(links.unavailable).toEqual([]);
  });
  it('reads item starters once at connect, not on every link read', async () => {
    db.insert('item_template', { entry: '26', name: 'Torn Letter', startquest: '60001' });
    db.insert('quest_template', { ID: '60002', LogTitle: 'More wolves' });
    db.insert('quest_template_addon', { ID: '60002', PrevQuestID: '60001' });
    const spy = vi.spyOn(db, 'selectRows');
    const starterReads = (): number =>
      spy.mock.calls.filter(([table, where]) => table === 'item_template' && 'startquest' in where).length;
    const { api } = await connected();
    const atConnect = starterReads();
    const open = ok(await api.addQuestChain(60001)).open;
    ok(await api.validate(open.questId));
    ok(await api.listNodes());
    const links = ok(await api.questLinks([60001]));
    expect(links.instances.some((i) => i.component === 'start.item')).toBe(true);
    expect(starterReads()).toBe(atConnect);
  });
  it('lists script rows it does not understand', async () => {
    db.insert('smart_scripts', { entryorguid: '60001', source_type: '5', id: '0', link: '0', event_type: '48', action_type: '12', comment: '' });
    const { api } = await connected();
    ok(await api.openQuest(60001));
    const links = ok(await api.questLinks([60001]));
    expect(links.unrecognised).toEqual([{
      questId: 60001, key: 'entryorguid=60001,source_type=5,id=0,link=0',
      summary: 'when a quest objective is completed: SmartAI action 12 (quest 60001, row 0)',
    }]);
  });
});
