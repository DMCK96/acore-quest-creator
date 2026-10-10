import { describe, expect, it } from 'vitest';
import { allTools } from '../../src/main/mcp/tools';
import { mcpFixture } from '../helpers/mcp-fixture';

const at = { x: -9400, y: 80, z: 57, orientation: 1 };

/** A project quest with a title, level and a giver, made through the tools */
async function projectQuest(f: Awaited<ReturnType<typeof mcpFixture>>, title: string, giver?: number): Promise<number> {
  const { questId } = (await f.call('new_quest')).value;
  await f.call('set_quest_fields', { questId, fields: { 'quest_template.LogTitle': title, 'quest_template.QuestLevel': 12 } });
  if (giver) {
    const quest = f.session.quests.get(questId)!;
    quest.aggregate.values['creature_queststarter'] = [{ id: giver }];
    f.session.quests.put(quest);
  }
  return questId;
}

describe('lookups read the project before the database', () => {
  it('search_quests finds a project quest the database has never heard of, marked as the project\'s', async () => {
    const f = await mcpFixture(allTools);
    const questId = await projectQuest(f, 'Kobold Camp Cleanup');
    const out = await f.call('search_quests', { text: 'kobold' });
    expect(out.value).toEqual([{ id: questId, title: 'Kobold Camp Cleanup', level: 12, source: 'project' }]);
  });

  it('search_quests shows the project\'s title, not the stale database one, for a quest both have', async () => {
    const f = await mcpFixture(allTools);
    const { questId } = (await f.call('new_quest')).value;
    f.db.insert('quest_template', { ID: String(questId), LogTitle: 'Stale Database Title', QuestLevel: '5' });
    await f.call('set_quest_fields', { questId, fields: { 'quest_template.LogTitle': 'Fresh Project Title' } });
    expect((await f.call('search_quests', { text: 'stale' })).value).toEqual([]);
    expect((await f.call('search_quests', { text: 'fresh' })).value).toMatchObject([{ id: questId, title: 'Fresh Project Title', source: 'project' }]);
  });

  it('quests_of_npc counts a quest the project gives to the NPC', async () => {
    const f = await mcpFixture(allTools);
    const questId = await projectQuest(f, 'Help the Guard', 1423);
    const out = await f.call('quests_of_npc', { entry: 1423 });
    expect(out.value.starts).toEqual([{ id: questId, title: 'Help the Guard', source: 'project' }]);
    expect(out.value.ends).toEqual([]);
  });

  it('find_spawns reports a moved spawn at its new place, and one placed in the view', async () => {
    const f = await mcpFixture(allTools);
    await f.call('move_spawn', { kind: 'creature', guid: 80330, ...at });
    const placed = (await f.call('add_spawn', { kind: 'creature', entry: 1423, map: 0, ...at, x: -9300 })).value.guid;
    const { spawns } = (await f.call('find_spawns', { kind: 'creature', entry: 1423 })).value;
    expect(spawns.find((s: any) => s.guid === 80330)).toMatchObject({ x: -9400, y: 80, source: 'project', movedFrom: { x: -9481.31, y: 74.42 } });
    expect(spawns.find((s: any) => s.guid === placed)).toMatchObject({ x: -9300, source: 'project' });
  });

  it('find_spawns and view_spawns leave out a spawn the project deleted', async () => {
    const f = await mcpFixture(allTools);
    await f.call('delete_world_spawn', { kind: 'creature', guid: 80330 });
    expect((await f.call('find_spawns', { kind: 'creature', entry: 1423 })).value.spawns).toEqual([]);
    const view = (await f.call('view_spawns', { map: 0, minX: -9600, maxX: -9300, minY: 0, maxY: 200 })).value;
    expect(view.creatures.map((c: any) => c.guid)).not.toContain(80330);
  });

  it('view_spawns shows the spawn where the project moved it, and follows it out of the box', async () => {
    const f = await mcpFixture(allTools);
    const box = { map: 0, minX: -9600, maxX: -9300, minY: 0, maxY: 200 };
    await f.call('move_spawn', { kind: 'creature', guid: 80330, ...at });
    const moved = (await f.call('view_spawns', box)).value.creatures.find((c: any) => c.guid === 80330);
    expect(moved).toMatchObject({ x: -9400, source: 'project' });
    await f.call('move_spawn', { kind: 'creature', guid: 80330, ...at, x: 5000 });
    expect((await f.call('view_spawns', box)).value.creatures.map((c: any) => c.guid)).not.toContain(80330);
  });
});
