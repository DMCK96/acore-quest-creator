import { describe, expect, it } from 'vitest';
import { allTools } from '../../src/main/mcp/tools';
import { mcpFixture } from '../helpers/mcp-fixture';

const json = (body: unknown, status = 200) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
const EXTRACT = 'Goldshire is a town.\n== History ==\nOld days.';

describe('lore tools', () => {
  it('find_zone turns a number into a zone, and works without server data', async () => {
    const { call } = await mcpFixture(allTools);
    const out = await call('find_zone', { text: '12' });
    expect(out.value).toEqual([{ id: 12, name: 'Zone 12', detail: 'Zone' }]);
  });

  it('quests_in_zone and quest_summaries read quests without importing them', async () => {
    const { call, db, api } = await mcpFixture(allTools);
    db.insert('quest_template', { ID: '33', LogTitle: 'Kobold Camp Cleanup', QuestLevel: '10', QuestSortID: '12', QuestDescription: 'Kobolds!' });
    const zone = await call('quests_in_zone', { zone: 12, minLevel: 9 });
    expect(zone.value.quests.map((q: any) => q.id)).toEqual([33]);
    const summary = await call('quest_summaries', { questIds: [33, 999] });
    expect(summary.value.quests[0].text.details).toBe('Kobolds!');
    expect(summary.value.missing).toEqual([999]);
    expect(((await api.listNodes()) as any).value).toEqual([]);
  });

  it('area_overview lists the guard with the way he faces, so a neighbour can be placed to match', async () => {
    const { call } = await mcpFixture(allTools);
    const out = await call('area_overview', { map: 0, x: -9481, y: 74, radius: 50 });
    expect(out.isError).toBe(false);
    const spawn = out.value.npcs[0].spawns[0];
    expect(out.value.npcs[0].entry).toBe(1423);
    expect(spawn.orientation).toBeCloseTo(1.5, 3);
    expect(spawn.facing).toBe('W');
    expect(spawn).toHaveProperty('distance');
  });

  it('area_overview defaults the radius to 100 and refuses more than 500', async () => {
    const { call } = await mcpFixture(allTools);
    expect((await call('area_overview', { map: 0, x: -9481, y: 74 })).value.query.radius).toBe(100);
    expect((await call('area_overview', { map: 0, x: -9481, y: 74, radius: 501 })).isError).toBe(true);
  });

  it('check_names and check_ids find the guard and say a free id is free', async () => {
    const { call } = await mcpFixture(allTools);
    const names = await call('check_names', { kind: 'creature', names: ['Stormwind Guard'] });
    expect(names.value[0].exact[0]).toMatchObject({ id: 1423, source: 'database' });
    const ids = await call('check_ids', { kind: 'creature', ids: [1423, 99999] });
    expect(ids.value[0].database).toEqual({ name: 'Stormwind Guard' });
    expect(ids.value[1]).toEqual({ id: 99999, database: null, project: null });
  });

  it('database lore tools answer NOT_CONNECTED, with the hint to connect, before connecting', async () => {
    const { call } = await mcpFixture(allTools, { connect: false });
    const out = await call('area_overview', { map: 0, x: 0, y: 0 });
    expect(out.isError).toBe(true);
    expect(out.value.code).toBe('NOT_CONNECTED');
    expect(out.value.message).toMatch(/connect/i);
  });

  it('wiki tools are off by default: a tool error that says where to turn them on, and nothing is fetched', async () => {
    const urls: string[] = [];
    const { call } = await mcpFixture(allTools, { fetch: (url) => { urls.push(url); return json({}); } });
    for (const out of [await call('wiki_search', { text: 'Goldshire' }), await call('wiki_page', { title: 'Goldshire' })]) {
      expect(out.isError).toBe(true);
      expect(out.value.code).toBe('NOT_ENABLED');
      expect(out.value.message).toMatch(/MCP \/ AI/);
    }
    expect(urls).toEqual([]);
  });

  it('wiki tools search and read a page when the user has switched them on, with the url and the notes', async () => {
    const { call } = await mcpFixture(allTools, {
      wiki: true,
      fetch: (url) => (url.includes('list=search')
        ? json({ query: { search: [{ ns: 0, title: 'Goldshire', snippet: 'A <span class="searchmatch">town</span>.' }] } })
        : json({ query: { pages: { '1': { pageid: 1, title: 'Goldshire', extract: EXTRACT } } } })),
    });
    const search = await call('wiki_search', { text: 'Goldshire' });
    expect(search.value.results[0]).toEqual({ title: 'Goldshire', snippet: 'A town.', url: 'https://warcraft.wiki.gg/wiki/Goldshire' });
    expect(search.value.license).toMatch(/CC|Creative Commons/);
    expect(search.value.note).toMatch(/3\.3\.5/);
    expect(search.value.note).toMatch(/inspiration/);
    const page = await call('wiki_page', { title: 'Goldshire', section: 'History' });
    expect(page.value.section.text).toBe('Old days.');
  });

  it('wiki tools report a refused request as a plain error', async () => {
    const { call } = await mcpFixture(allTools, { wiki: true, fetch: () => json('blocked', 403) });
    const out = await call('wiki_search', { text: 'Goldshire' });
    expect(out.isError).toBe(true);
    expect(out.value.message).toMatch(/refused/i);
  });

  it('none of the lore tools flush, notify or open a history step', async () => {
    const { call, order, api } = await mcpFixture(allTools);
    await call('area_overview', { map: 0, x: -9481, y: 74 });
    await call('check_names', { kind: 'creature', names: ['x'] });
    await call('quests_in_zone', { zone: 12 });
    expect(order).toEqual([]);
    expect(((await api.historyList()) as any).value.steps).toEqual([]);
  });

  it('area_overview says how an object with no rotation is read', () => {
    expect(allTools.find((t) => t.name === 'area_overview')!.description).toMatch(/all zeros/);
  });
});
