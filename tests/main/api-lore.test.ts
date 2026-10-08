import { describe, expect, it } from 'vitest';
import { createApi } from '../../src/main/api';
import { openStore } from '../../src/main/store/store';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta } from '../../src/main/project/project-file';
import type { ProjectController } from '../../src/main/project/controller';
import { parseRequest } from '../../src/shared/ipc';
import { forkDb } from '../helpers/fixtures';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };
const json = (body: unknown, status = 200) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });

async function setup(opts: { connect?: boolean; wiki?: boolean; fetch?: (url: string) => ReturnType<typeof json> } = {}) {
  const db = forkDb();
  db.insert('creature_template', { entry: '1423', name: 'Stormwind Guard', minlevel: '55', maxlevel: '55', faction: '11' });
  db.insert('creature', { guid: '80330', id1: '1423', map: '0', position_x: '-9481.31', position_y: '74.42', position_z: '56.55', orientation: '1.5' });
  db.insert('quest_template', { ID: '33', LogTitle: 'Kobold Camp Cleanup', QuestLevel: '10', QuestSortID: '12' });
  const session = createProjectSession(defaultProjectMeta('P', 'C:/out'));
  const fetched: string[] = [];
  const api = createApi({
    store: openStore(':memory:', box), openWorldDb: async () => db, openDevDb: async () => { throw new Error('x'); },
    fs: { writeFile: async () => {}, ensureDir: async () => {}, listDir: async () => [] }, now: () => new Date(), session, projects: {} as ProjectController,
    mcp: { wikiEnabled: () => opts.wiki ?? false } as never,
    fetch: async (url) => { fetched.push(url); return (opts.fetch ?? (() => json({ query: { search: [] } })))(url); },
  });
  const rec: any = await api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p' });
  if (opts.connect !== false) await api.connect(rec.value.id);
  return { api, db, session, fetched };
}

describe('lore API: the database calls', () => {
  it('answers NOT_CONNECTED before connecting', async () => {
    const { api } = await setup({ connect: false });
    for (const out of [await api.questsInZone(12), await api.questSummaries([33]), await api.areaOverview(0, 0, 0, 50), await api.checkNames('creature', ['x']), await api.checkIds('creature', [1])]) {
      expect(out).toMatchObject({ ok: false, error: { code: 'NOT_CONNECTED' } });
    }
  });

  it("lists a zone's quests, naming the zone by its id when there is no server data", async () => {
    const { api } = await setup();
    const out: any = await api.questsInZone(12, { minLevel: 5 });
    expect(out.value.zone).toEqual({ id: 12, name: 'Zone 12' });
    expect(out.value.quests.map((q: any) => q.id)).toEqual([33]);
  });

  it('reads quest summaries, and reports ids it does not have', async () => {
    const { api } = await setup();
    const out: any = await api.questSummaries([33, 999]);
    expect(out.value.quests.map((q: any) => q.title)).toEqual(['Kobold Camp Cleanup']);
    expect(out.value.missing).toEqual([999]);
  });

  it('describes the area around a point with the way the NPC faces', async () => {
    const { api } = await setup();
    const out: any = await api.areaOverview(0, -9481, 74, 50);
    expect(out.value.npcs[0]).toMatchObject({ entry: 1423, name: 'Stormwind Guard', level: { min: 55, max: 55 }, faction: { template: 11, name: null } });
    expect(out.value.npcs[0].spawns[0]).toMatchObject({ guid: 80330, facing: 'W' });
  });

  it("checks names and ids against the database and the project's own entities and quests", async () => {
    const { api, session } = await setup();
    const mine = (await api.readExistingEntity('npc', 1423)) as any;
    await api.putProjectEntities({ npcs: [{ ...mine.value, entry: 90001, name: 'Stormwind Guard', spawns: [] }], objects: [], items: [] });
    const quest: any = await api.newQuest();
    await api.updateQuest({ ...quest.value.aggregate, values: { ...quest.value.aggregate.values, 'quest_template.LogTitle': 'Kobold Camp Cleanup' } });
    expect(session.quests.list()).toHaveLength(1);

    const names: any = await api.checkNames('creature', ['Stormwind Guard']);
    expect(names.value[0].exact.map((m: any) => `${m.source}:${m.id}`).sort()).toEqual(['database:1423', 'project:90001']);
    const questNames: any = await api.checkNames('quest', ['Kobold Camp Cleanup']);
    expect(questNames.value[0].exact.map((m: any) => m.source).sort()).toEqual(['database', 'project']);
    const ids: any = await api.checkIds('creature', [1423, 90001, 5]);
    expect(ids.value.map((c: any) => [c.id, !!c.database, !!c.project])).toEqual([[1423, true, false], [90001, false, true], [5, false, false]]);
  });
});

describe('lore API: untitled project quests', () => {
  it('still count when checking ids, though they have no name to clash with', async () => {
    const { api } = await setup();
    const quest: any = await api.newQuest();
    const id = quest.value.questId;
    const ids: any = await api.checkIds('quest', [id]);
    expect(ids.value[0].project).not.toBeNull();
    const names: any = await api.checkNames('quest', ['x']);
    expect(names.value[0].exact).toEqual([]);
    expect(names.value[0].similar).toEqual([]);
  });
});

describe('lore API: the wiki calls', () => {
  it('are turned off by default: they answer NOT_ENABLED and fetch nothing', async () => {
    const { api, fetched } = await setup({ wiki: false });
    expect(await api.wikiSearch('Goldshire')).toMatchObject({ ok: false, error: { code: 'NOT_ENABLED' } });
    expect(await api.wikiPage('Goldshire')).toMatchObject({ ok: false, error: { code: 'NOT_ENABLED' } });
    expect(fetched).toEqual([]);
  });

  it('need no database connection when they are on', async () => {
    const { api, fetched } = await setup({
      connect: false, wiki: true,
      fetch: () => json({ query: { search: [{ ns: 0, title: 'Goldshire', snippet: 'A town.' }] } }),
    });
    const out: any = await api.wikiSearch('Goldshire');
    expect(out.ok).toBe(true);
    expect(out.value.results[0].url).toBe('https://warcraft.wiki.gg/wiki/Goldshire');
    expect(fetched).toHaveLength(1);
  });

  it('turn a refused request into a QUERY error that says so', async () => {
    const { api } = await setup({ wiki: true, fetch: () => json('blocked', 403) });
    const out: any = await api.wikiPage('Goldshire');
    expect(out.error.code).toBe('QUERY');
    expect(out.error.message).toMatch(/refused/i);
  });

  it('answer a plain error when the build has no fetch', async () => {
    const api = createApi({
      store: openStore(':memory:', box), openWorldDb: async () => forkDb(), openDevDb: async () => { throw new Error('x'); },
      fs: { writeFile: async () => {}, ensureDir: async () => {}, listDir: async () => [] }, now: () => new Date(),
      session: createProjectSession(defaultProjectMeta('P', 'C:/out')), projects: {} as ProjectController, mcp: { wikiEnabled: () => true } as never,
    });
    expect(await api.wikiSearch('x')).toMatchObject({ ok: false, error: { code: 'QUERY' } });
  });
});

describe('lore API: request checks', () => {
  it('bound every argument', () => {
    const ok = (m: string, a: unknown[]) => parseRequest(m as never, a).ok;
    expect(ok('areaOverview', [0, -9465, 30, 100])).toBe(true);
    expect(ok('areaOverview', [0, -9465, 30, 501])).toBe(false);
    expect(ok('areaOverview', [0, -9465, 30, 0])).toBe(false);
    expect(ok('areaOverview', [0, Number.NaN, 30, 50])).toBe(false);
    expect(ok('questSummaries', [Array.from({ length: 25 }, (_, i) => i + 1)])).toBe(true);
    expect(ok('questSummaries', [Array.from({ length: 26 }, (_, i) => i + 1)])).toBe(false);
    expect(ok('questsInZone', [12, { limit: 200 }])).toBe(true);
    expect(ok('questsInZone', [12, { limit: 201 }])).toBe(false);
    expect(ok('checkNames', ['npc', ['x']])).toBe(false);
    expect(ok('checkNames', ['creature', ['x'.repeat(101)]])).toBe(false);
    expect(ok('checkIds', ['item', [1, 2]])).toBe(true);
    expect(ok('wikiSearch', ['Goldshire', 10])).toBe(true);
    expect(ok('wikiSearch', ['Goldshire', 11])).toBe(false);
    expect(ok('wikiSearch', ['', 5])).toBe(false);
    expect(ok('wikiPage', ['Goldshire', 'History'])).toBe(true);
    expect(ok('wikiPage', ['x'.repeat(201)])).toBe(false);
  });
});
