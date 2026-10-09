import { describe, expect, it } from 'vitest';
import { allTools } from '../../src/main/mcp/tools';
import { mcpFixture } from '../helpers/mcp-fixture';

const labels = async (api: any) => (await api.historyList()).value.steps.map((s: any) => s.label);
const at = { x: -9470, y: 74.42, z: 56.55, orientation: 2 };

describe('world tools', () => {
  it('add_spawn places a spawn as one step and world_changes lists it', async () => {
    const { call, api } = await mcpFixture(allTools);
    const out = await call('add_spawn', { kind: 'creature', entry: 1423, map: 0, ...at });
    expect(out.value.guid).toBeGreaterThan(0);
    expect((await call('world_changes')).value.map((c: any) => c.type)).toEqual(['added']);
    expect(await labels(api)).toEqual(['AI: place creature 1423']);
  });

  it('move_spawn, set_respawn and set_movement edit a database spawn in the world layer', async () => {
    const { call, api } = await mcpFixture(allTools);
    expect((await call('move_spawn', { kind: 'creature', guid: 80330, ...at })).isError).toBe(false);
    expect((await call('set_respawn', { kind: 'creature', guid: 80330, seconds: 300 })).isError).toBe(false);
    expect((await call('set_movement', { guid: 80330, type: 'wander', wander: 5, pathId: null })).isError).toBe(false);
    const types = (await call('world_changes')).value.map((c: any) => c.type).sort();
    expect(types).toEqual(['movement', 'respawn', 'spawn']);
    expect(await labels(api)).toEqual(['AI: move creature 80330', 'AI: set respawn of creature 80330', 'AI: set movement of 80330']);
  });

  it('set_route stores a path and revert_world_change takes it back out', async () => {
    const { call } = await mcpFixture(allTools);
    const pts = [{ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 }];
    expect((await call('set_route', { pathId: 801, points: pts, isNew: true })).isError).toBe(false);
    expect((await call('world_changes')).value.map((c: any) => c.type)).toContain('route');
    await call('revert_world_change', { target: { kind: 'route', pathId: 801 } });
    expect((await call('world_changes')).value).toEqual([]);
  });

  it('refuses a spawn of an NPC that has no id', async () => {
    const { call, api } = await mcpFixture(allTools);
    const out = await call('add_spawn', { kind: 'creature', entry: 0, map: 0, ...at });
    expect(out.isError).toBe(true);
    expect(await labels(api)).toEqual([]);
  });
  it('add_spawn places an object with the rotation it is given, and move_spawn can turn it', async () => {
    const { call, db } = await mcpFixture(allTools);
    db.insert('gameobject_template', { entry: '500', type: '8', displayId: '1', name: 'Anvil', size: '1' });
    const turn = [0, 0, 0.7071, 0.7071];
    const out = await call('add_spawn', { kind: 'gameobject', entry: 500, map: 0, ...at, rotation: turn });
    expect(out.isError).toBe(false);
    const added = (await call('world_changes')).value.find((c: any) => c.type === 'added');
    expect(added.placement.rotation).toEqual(turn);
    const again = [0, 0, 1, 0];
    await call('move_spawn', { kind: 'gameobject', guid: out.value.guid, ...at, rotation: again });
    const moved = (await call('world_changes')).value.find((c: any) => c.type === 'added');
    expect(moved.placement.rotation).toEqual(again);
  });

  it('add_spawn without a rotation still places an NPC with none', async () => {
    const { call } = await mcpFixture(allTools);
    await call('add_spawn', { kind: 'creature', entry: 1423, map: 0, ...at });
    const added = (await call('world_changes')).value.find((c: any) => c.type === 'added');
    expect(added.placement.rotation).toBeNull();
  });
});

describe('movement defaults', () => {
  it('set_movement needs only the type: idle ignores the radius and path, wander needs no path', async () => {
    const { call } = await mcpFixture(allTools);
    expect((await call('set_movement', { guid: 80330, type: 'idle' })).isError).toBe(false);
    expect((await call('set_movement', { guid: 80330, type: 'wander', wander: 5 })).isError).toBe(false);
    expect((await call('world_changes')).value.map((c: any) => c.type)).toContain('movement');
  });
});

describe('entity tools', () => {
  it('reads an existing NPC, saves it into the project under a new name, and replaces it on a second save', async () => {
    const { call, api } = await mcpFixture(allTools);
    const existing = (await call('read_existing_entity', { kind: 'npc', entry: 1423 })).value;
    expect(existing.entry).toBe(1423);
    expect((await call('upsert_entity', { kind: 'npc', entity: { ...existing, name: 'Marshal Dughan II' } })).isError).toBe(false);
    expect((await call('upsert_entity', { kind: 'npc', entity: { ...existing, name: 'Marshal Dughan III' } })).isError).toBe(false);
    const store = (await call('list_project_entities')).value;
    expect(store.npcs).toHaveLength(1);
    expect(store.npcs[0].name).toBe('Marshal Dughan III');
    expect(await labels(api)).toEqual(['AI: save npc 1423', 'AI: save npc 1423']);
  });

  it('refuses an entity without an entry and a garbage entity, leaving no step', async () => {
    const { call, api } = await mcpFixture(allTools);
    expect((await call('upsert_entity', { kind: 'npc', entity: { name: 'x' } })).isError).toBe(true);
    expect((await call('upsert_entity', { kind: 'npc', entity: { entry: 5, spawns: 'no' } })).isError).toBe(true);
    expect(await labels(api)).toEqual([]);
  });

  it('allocate_ids hands out distinct ids and is not a write', async () => {
    const { call, order } = await mcpFixture(allTools);
    const ids = (await call('allocate_ids', { kind: 'creature', count: 3 })).value;
    expect(new Set(ids).size).toBe(3);
    expect(order).toEqual([]);
  });

  it('allocate_ids can hand out gossip menu and text ids', async () => {
    const { call } = await mcpFixture(allTools);
    for (const kind of ['gossipMenu', 'gossipText']) {
      const result = await call('allocate_ids', { kind, count: 2 });
      expect(result.isError).toBeFalsy();
      expect(result.value).toHaveLength(2);
      expect(result.value[1] - result.value[0]).toBe(1);
    }
  });

  it('allocate_ids can hand out trainer ids', async () => {
    const { call } = await mcpFixture(allTools);
    const result = await call('allocate_ids', { kind: 'trainer', count: 2 });
    expect(result.isError).toBeFalsy();
    expect(result.value).toHaveLength(2);
    expect(result.value[1] - result.value[0]).toBe(1);
  });

  it('delete_entity removes a saved NPC as one step', async () => {
    const { call, api } = await mcpFixture(allTools);
    const existing = (await call('read_existing_entity', { kind: 'npc', entry: 1423 })).value;
    await call('upsert_entity', { kind: 'npc', entity: existing });
    await call('delete_entity', { kind: 'npc', entry: 1423 });
    expect((await call('list_project_entities')).value.npcs).toEqual([]);
    expect((await labels(api)).at(-1)).toBe('AI: delete npc 1423');
  });

  it('tells the model which way orientation 0 points when placing or moving a spawn', () => {
    for (const name of ['add_spawn', 'move_spawn']) {
      const tool = allTools.find((t) => t.name === name)!;
      expect(tool.description).toMatch(/0 faces north/);
    }
  });
});
