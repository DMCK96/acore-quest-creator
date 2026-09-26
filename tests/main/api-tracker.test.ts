import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createApi, type ApiDeps } from '../../src/main/api';
import { openStore } from '../../src/main/store/store';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta } from '../../src/main/project/project-file';
import type { ProjectController } from '../../src/main/project/controller';
import { readEntities } from '../../src/core/entities/model';
import { forkDb } from '../helpers/fixtures';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };

async function setup(over: Partial<ApiDeps> = {}) {
  const db = forkDb();
  const api = createApi({ store: openStore(':memory:', box), openWorldDb: async () => db, openDevDb: async () => { throw new Error('x'); },
    fs: { writeFile: async () => {}, ensureDir: async () => {}, listDir: async () => [] }, now: () => new Date('2026-09-26T00:00:00Z'),
    session: createProjectSession(defaultProjectMeta('P', 'C:\\out')), projects: {} as ProjectController, ...over });
  const rec: any = await api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p' });
  await api.connect(rec.value.id);
  return { api, db };
}

const fixture = (n: number): any => JSON.parse(readFileSync(`tests/fixtures/candidates/p${n}.json`, 'utf8'));
/** p1224 with one placed spawn on its NPC, so the import has a guid to allocate. */
function withSpawn(): any {
  const p = fixture(1224);
  for (const d of p.dependencies) if (d.kind === 'npc' && d.record) d.record._extra.spawns = [{ map: 530, x: 10, y: 20, z: 30, o: 1, source: 'harvest' }];
  return p;
}

function fakeTracker(posts: unknown[] = [], payloads: Record<number, any> = {}) {
  return (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    if (u.pathname === '/api/candidates/payload') {
      const id = Number(u.searchParams.get('quest'));
      return new Response(JSON.stringify(payloads[id] ?? fixture(id)), { status: 200 });
    }
    if (u.pathname === '/api/candidate') return new Response(JSON.stringify({ work: { state: 'queued', notes: 'old note' } }), { status: 200 });
    if (u.pathname === '/api/candidates/work') {
      posts.push(JSON.parse(String(init!.body)));
      return new Response('{}', { status: 200 });
    }
    if (u.pathname === '/api/candidates') {
      return new Response(JSON.stringify({ total: 1, rows: [{ key: 1209, title: 'W', status: 'Ready', tier: 2, tier_label: '', top_blocker: '', giver: '', ender: '', work: 'none' }] }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
}

describe('importing candidates through the API', () => {
  it('previews and imports a candidate, keeping its ID, and tells the tracker', async () => {
    const posts: unknown[] = [];
    const { api, db } = await setup({ trackerFetch: fakeTracker(posts) });
    db.insert('creature_template', { entry: '18200', name: 'Fitz' });
    db.insert('creature_template', { entry: '17128', name: 'Windroc' });
    db.insert('item_template', { entry: '375250', name: 'Token' });
    const preview: any = await api.trackerPreview([1209]);
    expect(preview.value.quests[0]).toMatchObject({ questId: 1209, action: 'create' });
    const done: any = await api.trackerImport({ questIds: [1209], replace: [] });
    expect(done.value).toMatchObject({ imported: [1209], skipped: [], warnings: [] });
    const nodes: any = await api.listNodes();
    expect(nodes.value.map((n: any) => n.questId)).toContain(1209);
    const open: any = await api.openQuest(1209);
    expect(open.value.aggregate.values['quest_template.LogTitle']).toBe('Windroc Remastery I');
    expect(open.value.aggregate.values.creature_queststarter).toEqual([{ id: 18200 }]);
    expect(posts).toEqual([{ kind: 'quest', key: 1209, state: 'in_progress', notes: 'Imported into P\nold note' }]);
    const list: any = await api.trackerCandidates({});
    expect(list.value.inProject).toEqual([1209]);
  });
  it('creates missing NPCs and objects and allocates guids for their spawns', async () => {
    const { api } = await setup({ trackerFetch: fakeTracker([], { 1224: withSpawn() }) });
    const done: any = await api.trackerImport({ questIds: [1224], replace: [] });
    expect(done.value.imported).toEqual([1224]);
    const open: any = await api.openQuest(1224);
    const { npcs, objects } = readEntities(open.value.aggregate.values);
    expect(objects.map((o) => o.entry)).toEqual([402000, 412000]);
    expect(npcs.map((n) => n.entry)).toEqual([33]);
    expect(npcs[0]!.spawns).toHaveLength(1);
    expect(npcs[0]!.spawns[0]).toMatchObject({ map: 530, x: 10, y: 20, z: 30 });
    expect(npcs[0]!.spawns[0]!.guid).toBeGreaterThan(0);
  });
  it('skips a quest in the project unless replace is asked, and moves entities another quest still uses', async () => {
    const { api } = await setup({ trackerFetch: fakeTracker() });
    await api.trackerImport({ questIds: [1215], replace: [] });
    const other: any = await api.newQuest();
    const agg = other.value.aggregate;
    agg.values.creature_queststarter = [{ id: 2 }];
    await api.updateQuest(agg);
    const again: any = await api.trackerImport({ questIds: [1215], replace: [] });
    expect(again.value.skipped).toEqual([{ questId: 1215, reason: 'Quest 1215 is already in this project.' }]);
    const replaced: any = await api.trackerImport({ questIds: [1215], replace: [1215] });
    expect(replaced.value.replaced).toEqual([1215]);
    const reopened: any = await api.openQuest(agg.questId);
    expect(readEntities(reopened.value.aggregate.values).npcs.map((n) => n.entry)).toEqual([2]);
    const imported: any = await api.openQuest(1215);
    expect(readEntities(imported.value.aggregate.values).npcs).toEqual([]);
  });
  it('still imports when the tracker cannot record the work state', async () => {
    const base = fakeTracker();
    const { api } = await setup({
      trackerFetch: (async (u: any, i?: any) => (String(u).endsWith('/work') ? new Response('{"error":"busy"}', { status: 409 }) : base(u, i))) as typeof fetch,
    });
    const done: any = await api.trackerImport({ questIds: [1209], replace: [] });
    expect(done.value.imported).toEqual([1209]);
    expect(done.value.warnings[0]).toMatch(/^Quest 1209 was imported, but the tracker did not record it: /);
  });
  it('reports a tracker that is not running', async () => {
    const { api } = await setup({ trackerFetch: (async () => { throw new TypeError('fetch failed'); }) as typeof fetch });
    const r: any = await api.trackerCandidates({});
    expect(r.ok).toBe(false);
    expect(r.error.message).toBe("The CoA Content Tracker isn't running at http://127.0.0.1:8089. Start it with python tracker.py.");
  });
});
