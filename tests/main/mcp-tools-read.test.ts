import { describe, expect, it } from 'vitest';
import { allTools } from '../../src/main/mcp/tools';
import { mcpFixture } from '../helpers/mcp-fixture';

describe('read tools', () => {
  it('list_profiles never shows a password, and project_state names the project', async () => {
    const { call } = await mcpFixture(allTools);
    const profiles = await call('list_profiles');
    expect(profiles.value).toHaveLength(1);
    expect(JSON.stringify(profiles.value)).not.toMatch(/password/i);
    expect((await call('project_state')).value.name).toBe('P');
  });

  it('search_quests finds a quest by title', async () => {
    const { call, db } = await mcpFixture(allTools);
    db.insert('quest_template', { ID: '33', LogTitle: 'Kobold Camp Cleanup', QuestLevel: '10' });
    const out = await call('search_quests', { text: 'Kobold' });
    expect(out.value).toEqual([{ id: 33, title: 'Kobold Camp Cleanup', level: 10 }]);
  });

  it('search_entities and lookup_names find the guard', async () => {
    const { call } = await mcpFixture(allTools);
    const hits = await call('search_entities', { kind: 'creature', text: 'Guard' });
    expect(hits.value.map((h: any) => h.id)).toContain(1423);
    const names = await call('lookup_names', { kind: 'creature', ids: [1423] });
    expect(names.value).toEqual({ '1423': 'Stormwind Guard' });
  });

  it('find_spawns lists where an NPC stands', async () => {
    const { call } = await mcpFixture(allTools);
    const out = await call('find_spawns', { kind: 'creature', entry: 1423 });
    expect(out.value.spawns).toHaveLength(1);
  });

  it('ground_height answers with a reason when there is no server data', async () => {
    const { call } = await mcpFixture(allTools);
    const out = await call('ground_height', { map: 0, x: -9481, y: 74 });
    expect(out.isError).toBe(false);
    expect(out.value).toHaveProperty('reason');
  });

  it('history_list and world_changes start empty', async () => {
    const { call } = await mcpFixture(allTools);
    expect((await call('history_list')).value.steps).toEqual([]);
    expect((await call('world_changes')).value).toEqual([]);
  });

  it('answers NOT_CONNECTED as a tool error before connect', async () => {
    const { call } = await mcpFixture(allTools, { connect: false });
    const out = await call('search_quests', { text: 'x' });
    expect(out.isError).toBe(true);
    expect(out.value.code).toBe('NOT_CONNECTED');
  });

  it('read tools do not flush, notify or open a history step', async () => {
    const { call, order } = await mcpFixture(allTools);
    await call('search_quests', { text: 'x' });
    await call('project_state');
    expect(order).toEqual([]);
    expect((await call('history_list')).value.steps).toEqual([]);
  });

  it('rejects a bad argument with BAD_REQUEST from the same schemas the window uses', async () => {
    const { call } = await mcpFixture(allTools);
    const out = await call('find_spawns', { kind: 'creature', entry: 1.5 });
    expect(out.isError).toBe(true);
  });
});

describe('the whole tool list', () => {
  it('has unique snake_case names, descriptions, and no password or dev-write tool', () => {
    const names = allTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of allTools) {
      expect(t.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(t.description.length).toBeGreaterThan(20);
      expect(Object.keys(t.input).join(' ')).not.toMatch(/password/i);
    }
    expect(names).not.toContain('apply_to_dev');
    expect(names.filter((n) => /profile/.test(n))).toEqual(['list_profiles']);
  });
});
