import { describe, expect, it } from 'vitest';
import { applyPreset } from '../../src/core/combat/presets';
import { allTools } from '../../src/main/mcp/tools';
import { mcpFixture } from '../helpers/mcp-fixture';

const labels = async (api: any) => (await api.historyList()).value.steps.map((s: any) => s.label);
const spawn = (guid: number) => ({ guid, map: 0, x: 1, y: 2, z: 3, o: 0, respawnSecs: 300, wander: 0, patrol: null, rotation: null, events: 'npc' });
const point = (x: number) => ({ x, y: 2, z: 3, waitSecs: 0, facing: null, paceFromHere: null, actions: [] });
const patrol = { pathId: 901000, startPace: 'walk', points: [point(1), point(5), point(9)] };
const rows = [{ item: 769, chance: 50, min: 1, max: 1, questOnly: false }];

async function withNpc() {
  const fx = await mcpFixture(allTools);
  const made = await fx.call('new_entity', { kind: 'npc', name: 'Captain Rellick' });
  return { ...fx, entry: made.value.entity.entry as number };
}

describe('new_entity', () => {
  it('makes an NPC with a free entry as one AI step, and says what is still missing', async () => {
    const { call, api } = await mcpFixture(allTools);
    const out = await call('new_entity', { kind: 'npc', name: 'Captain Rellick', fields: { minLevel: 12, maxLevel: 12, rank: 'elite' } });
    expect(out.isError).toBe(false);
    expect(out.value.entity).toMatchObject({ name: 'Captain Rellick', minLevel: 12, rank: 'elite', origin: { kind: 'new' } });
    expect(out.value.entity.entry).toBeGreaterThan(0);
    expect(out.value.issues.some((i: any) => i.code === 'ENTITY_NO_MODEL')).toBe(true);
    expect((await call('list_project_entities')).value.npcs).toHaveLength(1);
    expect(await labels(api)).toEqual(['AI: new npc']);
  });

  it('makes an object and an item with distinct entries', async () => {
    const { call } = await mcpFixture(allTools);
    const object = await call('new_entity', { kind: 'object', name: "Rellick's Strongbox" });
    const item = await call('new_entity', { kind: 'item', name: "Rellick's Oathblade", fields: { quality: 'epic', itemLevel: 20 } });
    expect(object.value.entity.type).toBe('goober');
    expect(item.value.entity).toMatchObject({ quality: 'epic', itemLevel: 20 });
    const store = (await call('list_project_entities')).value;
    expect(store.objects).toHaveLength(1);
    expect(store.items).toHaveLength(1);
  });

  it('refuses fields of the wrong type and fields it manages itself, changing nothing', async () => {
    const { call, api } = await mcpFixture(allTools);
    const wrong = await call('new_entity', { kind: 'npc', name: 'X', fields: { rank: 'godlike' } });
    expect(wrong.isError).toBe(true);
    expect(wrong.value.code).toBe('BAD_REQUEST');
    expect(wrong.value.message).toMatch(/rank/);
    for (const key of ['entry', 'origin', 'spawns']) {
      const out = await call('new_entity', { kind: 'npc', name: 'X', fields: { [key]: 1 } });
      expect(out.isError).toBe(true);
      expect(out.value.message).toContain(key);
    }
    expect(await labels(api)).toEqual([]);
  });
});

describe('set_npc_fight', () => {
  it('sets a fight and takes it away, each as one step', async () => {
    const { call, api, entry } = await withNpc();
    const out = await call('set_npc_fight', { entry, fight: applyPreset(null, 'melee') });
    expect(out.isError).toBe(false);
    expect((await call('list_project_entities')).value.npcs[0].fight.abilities).toHaveLength(1);
    await call('set_npc_fight', { entry, fight: null });
    expect((await call('list_project_entities')).value.npcs[0].fight).toBeNull();
    expect((await labels(api)).slice(-2)).toEqual([`AI: set fight of ${entry}`, `AI: set fight of ${entry}`]);
  });

  it("returns only that NPC's issues", async () => {
    const { call, entry } = await withNpc();
    await call('new_entity', { kind: 'npc', name: 'Someone Else' });
    const out = await call('set_npc_fight', { entry, fight: applyPreset(null, 'melee') });
    expect(out.value.issues.length).toBeGreaterThan(0);
    expect(out.value.issues.every((i: any) => /^NPC "Captain Rellick":/.test(i.message))).toBe(true);
  });

  it('refuses a fight with a wrong type, saying where, and leaves no step', async () => {
    const { call, api, entry } = await withNpc();
    const bad = { phases: [], reactions: [], abilities: [{ id: 'a1', spellId: 'x' }] };
    const out = await call('set_npc_fight', { entry, fight: bad });
    expect(out.isError).toBe(true);
    expect(out.value.message).toMatch(/abilities\.0/);
    expect(await labels(api)).toEqual(['AI: new npc']);
  });

  it('refuses an NPC that is not in the project, and says how to make one', async () => {
    const { call } = await mcpFixture(allTools);
    const out = await call('set_npc_fight', { entry: 424242, fight: null });
    expect(out.isError).toBe(true);
    expect(out.value.message).toMatch(/new_entity/);
  });

  it('refuses a database NPC whose fight is locked, and points at new_entity', async () => {
    const { call, api } = await mcpFixture(allTools);
    const existing = (await call('read_existing_entity', { kind: 'npc', entry: 1423 })).value;
    await call('upsert_entity', { kind: 'npc', entity: { ...existing, origin: { ...existing.origin, kind: 'existing', locked: ['fight', 'loot'] } } });
    const before = (await labels(api)).length;
    const out = await call('set_npc_fight', { entry: 1423, fight: applyPreset(null, 'melee') });
    expect(out.isError).toBe(true);
    expect(out.value.message).toMatch(/locked/);
    expect(out.value.message).toMatch(/new_entity/);
    expect((await labels(api)).length).toBe(before);
  });
});

describe('set_npc_patrol', () => {
  async function withSpawn() {
    const fx = await withNpc();
    const entity = (await fx.call('list_project_entities')).value.npcs[0];
    await fx.call('upsert_entity', { kind: 'npc', entity: { ...entity, spawns: [spawn(90100)] } });
    return fx;
  }

  it('sets and clears the patrol of one spawn', async () => {
    const { call, api, entry } = await withSpawn();
    const out = await call('set_npc_patrol', { entry, guid: 90100, patrol });
    expect(out.isError).toBe(false);
    expect((await call('list_project_entities')).value.npcs[0].spawns[0].patrol.points).toHaveLength(3);
    await call('set_npc_patrol', { entry, guid: 90100, patrol: null });
    expect((await call('list_project_entities')).value.npcs[0].spawns[0].patrol).toBeNull();
    expect((await labels(api)).at(-1)).toBe(`AI: set patrol of ${entry}`);
  });

  it('chooses the path id itself, ignoring one it is given, so it cannot collide with another route', async () => {
    const { call, entry } = await withSpawn();
    const { pathId: _omitted, ...bare } = patrol;
    await call('set_npc_patrol', { entry, guid: 90100, patrol: bare });
    expect((await call('list_project_entities')).value.npcs[0].spawns[0].patrol.pathId).toBe(901000);
    const fresh = (await call('new_entity', { kind: 'npc', name: 'Other' })).value.entity;
    const other = (await call('list_project_entities')).value.npcs.find((n: any) => n.entry === fresh.entry);
    await call('upsert_entity', { kind: 'npc', entity: { ...other, spawns: [spawn(90200)] } });
    await call('set_npc_patrol', { entry: fresh.entry, guid: 90200, patrol: { ...patrol, pathId: 901000 } });
    const got = (await call('list_project_entities')).value.npcs.find((n: any) => n.entry === fresh.entry).spawns[0].patrol.pathId;
    expect(got).toBe(902000);
  });

  it('keeps the spawn\'s own path id when its patrol is set again', async () => {
    const { call, entry } = await withSpawn();
    await call('set_npc_patrol', { entry, guid: 90100, patrol });
    const first = (await call('list_project_entities')).value.npcs[0].spawns[0].patrol.pathId;
    await call('set_npc_patrol', { entry, guid: 90100, patrol: { ...patrol, points: [point(1), point(2)] } });
    const second = (await call('list_project_entities')).value.npcs[0].spawns[0].patrol;
    expect(second.pathId).toBe(first);
    expect(second.points).toHaveLength(2);
  });

  it('names the spawns the NPC has when the guid is wrong', async () => {
    const { call, entry } = await withSpawn();
    const out = await call('set_npc_patrol', { entry, guid: 5, patrol });
    expect(out.isError).toBe(true);
    expect(out.value.message).toMatch(/90100/);
  });

  it('refuses a patrol with a wrong type', async () => {
    const { call, entry } = await withSpawn();
    const out = await call('set_npc_patrol', { entry, guid: 90100, patrol: { ...patrol, points: [{ x: 'a' }] } });
    expect(out.isError).toBe(true);
    expect(out.value.message).toMatch(/points\.0/);
  });
});

describe('set_loot', () => {
  it("replaces an NPC's loot and an object's loot", async () => {
    const { call, api, entry } = await withNpc();
    expect((await call('set_loot', { kind: 'npc', entry, rows })).isError).toBe(false);
    expect((await call('list_project_entities')).value.npcs[0].loot).toEqual(rows);
    const object = (await call('new_entity', { kind: 'object', name: 'Strongbox' })).value.entity.entry;
    expect((await call('set_loot', { kind: 'object', entry: object, rows })).isError).toBe(false);
    expect((await call('list_project_entities')).value.objects[0].loot).toEqual(rows);
    expect((await labels(api)).at(-1)).toBe(`AI: set loot of ${object}`);
  });

  it('refuses rows of the wrong type and a locked loot table, changing nothing', async () => {
    const { call, entry } = await withNpc();
    const bad = await call('set_loot', { kind: 'npc', entry, rows: [{ item: 'x', chance: 50, min: 1, max: 1, questOnly: false }] });
    expect(bad.isError).toBe(true);
    expect(bad.value.message).toMatch(/item/);
    const existing = (await call('read_existing_entity', { kind: 'npc', entry: 1423 })).value;
    await call('upsert_entity', { kind: 'npc', entity: { ...existing, origin: { ...existing.origin, kind: 'existing', locked: ['loot'] } } });
    const locked = await call('set_loot', { kind: 'npc', entry: 1423, rows });
    expect(locked.isError).toBe(true);
    expect(locked.value.message).toMatch(/locked/);
  });

  it('is taken back by undo', async () => {
    const { call, entry } = await withNpc();
    await call('set_loot', { kind: 'npc', entry, rows });
    await call('undo');
    expect((await call('list_project_entities')).value.npcs[0].loot).toEqual([]);
  });
});

describe('check_project_entities', () => {
  it('lists what is wrong with every new NPC, object and item, and is not a write', async () => {
    const { call, order } = await withNpc();
    const flushes = order.length;
    const out = await call('check_project_entities');
    expect(out.isError).toBe(false);
    expect(out.value.some((i: any) => i.code === 'ENTITY_NO_MODEL')).toBe(true);
    expect(order.length).toBe(flushes);
  });
});

describe('new_entity fields', () => {
  it('refuses a field name the entity does not have, and lists the ones it does', async () => {
    const { call, api } = await mcpFixture(allTools);
    const out = await call('new_entity', { kind: 'npc', name: 'X', fields: { level: 12, faction_id: 14 } });
    expect(out.isError).toBe(true);
    expect(out.value.code).toBe('BAD_REQUEST');
    expect(out.value.message).toContain('level');
    expect(out.value.message).toContain('faction_id');
    expect(out.value.message).toContain('minLevel');
    expect(((await api.historyList()) as any).value.steps).toEqual([]);
  });

  it('says in its description how a new NPC or object is placed', () => {
    const description = allTools.find((t) => t.name === 'new_entity')!.description;
    expect(description).toContain('upsert_entity');
    expect(description).toContain('allocate_ids');
    expect(description).toMatch(/existing/);
  });
});

describe('the scenes of an NPC', () => {
  const scene = { id: 's1', name: 'Greets', questId: 0, trigger: { kind: 'talkedTo' }, gates: [], steps: [{ kind: 'say', text: 'Hi', style: 'say', waitMs: 0 }] };

  it('stores scenes sent with upsert_entity and hands them back', async () => {
    const { call, entry } = await withNpc();
    const entity = (await call('list_project_entities')).value.npcs[0];
    const out = await call('upsert_entity', { kind: 'npc', entity: { ...entity, scenes: [scene] } });
    expect(out.isError).toBe(false);
    expect((await call('list_project_entities')).value.npcs.find((n: any) => n.entry === entry).scenes).toEqual([scene]);
  });

  it('refuses a scene with an invalid trigger, changing nothing', async () => {
    const { call, api } = await withNpc();
    const entity = (await call('list_project_entities')).value.npcs[0];
    const before = (await labels(api)).length;
    const out = await call('upsert_entity', { kind: 'npc', entity: { ...entity, scenes: [{ ...scene, trigger: { kind: 'bogus' } }] } });
    expect(out.isError).toBe(true);
    expect((await labels(api)).length).toBe(before);
    expect((await call('list_project_entities')).value.npcs[0].scenes).toEqual([]);
  });
});
