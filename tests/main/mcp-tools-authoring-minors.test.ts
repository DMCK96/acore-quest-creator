import { describe, expect, it } from 'vitest';
import { applyPreset } from '../../src/core/combat/presets';
import { allTools } from '../../src/main/mcp/tools';
import { mcpFixture } from '../helpers/mcp-fixture';

const scene = (over: Record<string, unknown> = {}) => ({
  name: 'Greeting', owner: { kind: 'creature', entry: 295 }, trigger: { kind: 'questAccepted' }, gates: [],
  steps: [{ kind: 'say', text: 'Hello, $N.', style: 'say', waitMs: 0 }], ...over,
});
const rows = [{ item: 769, chance: 50, min: 1, max: 1, questOnly: false }];
const failing = { ok: false, error: { code: 'INTERNAL', message: 'boom' } };

async function withQuest() {
  const fx = await mcpFixture(allTools);
  const { questId } = (await fx.call('new_quest')).value;
  return { ...fx, questId };
}

describe('scenes the editor cannot read', () => {
  const broken = { id: 's2', name: 'Damaged', owner: { kind: 'nobody' }, trigger: {}, gates: [], steps: [] };

  async function withBroken() {
    const fx = await withQuest();
    await fx.call('set_scene', { questId: fx.questId, scene: scene() });
    const opened: any = await fx.api.openQuest(fx.questId);
    const aggregate = opened.value.aggregate;
    const saved: any = await fx.api.updateQuest({ ...aggregate, values: { ...aggregate.values, scripts: [...aggregate.values.scripts, broken] } });
    expect(saved.ok).toBe(true);
    const stored = async (): Promise<any[]> => ((await fx.api.openQuest(fx.questId)) as any).value.aggregate.values.scripts;
    return { ...fx, stored };
  }

  it('are kept when a scene is added, and their id is not handed out again', async () => {
    const { call, questId, stored } = await withBroken();
    const out = await call('set_scene', { questId, scene: scene({ name: 'Third' }) });
    expect(out.value.sceneId).toBe('s3');
    const now = await stored();
    expect(now.map((s) => s.id)).toEqual(['s1', 's3', 's2']);
    expect(now.find((s) => s.id === 's2')).toEqual(broken);
  });

  it('are kept when another scene is removed, and listed by get_scenes', async () => {
    const { call, questId, stored } = await withBroken();
    await call('remove_scene', { questId, sceneId: 's1' });
    expect(await stored()).toEqual([broken]);
    expect((await call('get_scenes', { questId })).value.unreadable).toEqual(['s2']);
  });

  it('are replaced by a scene written with their id', async () => {
    const { call, questId, stored } = await withBroken();
    await call('set_scene', { questId, scene: scene({ id: 's2', name: 'Fixed' }) });
    expect((await stored()).map((s) => s.name)).toEqual(['Greeting', 'Fixed']);
  });

  it('are removed when their id is named', async () => {
    const { call, questId, stored } = await withBroken();
    const gone = await call('remove_scene', { questId, sceneId: 's2' });
    expect(gone.isError).toBe(false);
    expect((await stored()).map((s) => s.id)).toEqual(['s1']);
  });
});

describe('a change whose issues cannot be read afterwards', () => {
  it('is still reported as made when it is a scene', async () => {
    const { call, api, questId } = await withQuest();
    const real = api.validate;
    (api as any).validate = async () => failing;
    const out = await call('set_scene', { questId, scene: scene() });
    expect(out.isError).toBe(false);
    expect(out.value.sceneId).toBe('s1');
    expect(out.value.issues).toEqual([]);
    expect(out.value.issuesError).toMatch(/boom/);
    (api as any).validate = real;
    expect((await call('get_scenes', { questId })).value.scenes).toHaveLength(1);
  });

  it('is still reported as made when it is an entity', async () => {
    const { call, api } = await mcpFixture(allTools);
    (api as any).projectIssues = async () => failing;
    const out = await call('new_entity', { kind: 'npc', name: 'Captain Rellick' });
    expect(out.isError).toBe(false);
    expect(out.value.issues).toEqual([]);
    expect(out.value.issuesError).toMatch(/boom/);
    expect((await call('list_project_entities')).value.npcs).toHaveLength(1);
  });
});

describe('entities that share a name', () => {
  it('are answered with their own issues only', async () => {
    const { call } = await mcpFixture(allTools);
    const first = (await call('new_entity', { kind: 'npc', name: 'Guard' })).value.entity.entry;
    const second = (await call('new_entity', { kind: 'npc', name: 'Guard', fields: { displayId: 1 } })).value;
    expect(second.issues.some((i: any) => i.code === 'ENTITY_NO_MODEL')).toBe(false);
    const out = await call('set_npc_fight', { entry: first, fight: applyPreset(null, 'melee') });
    expect(out.value.issues.some((i: any) => i.code === 'ENTITY_NO_MODEL')).toBe(true);
    expect(out.value.issues.every((i: any) => i.about.entry === first)).toBe(true);
  });
});

describe('new_entity names', () => {
  it('refuses a name that is only spaces, and trims the rest', async () => {
    const { call, api } = await mcpFixture(allTools);
    expect((await call('new_entity', { kind: 'npc', name: '   ' })).isError).toBe(true);
    expect(((await api.historyList()) as any).value.steps).toEqual([]);
    expect((await call('new_entity', { kind: 'npc', name: '  Rellick ' })).value.entity.name).toBe('Rellick');
  });
});

describe('set_loot on an object', () => {
  it('warns when the object is not a chest, because its loot would not be exported', async () => {
    const { call } = await mcpFixture(allTools);
    const entry = (await call('new_entity', { kind: 'object', name: 'Strongbox' })).value.entity.entry;
    const out = await call('set_loot', { kind: 'object', entry, rows });
    expect(out.isError).toBe(false);
    expect(out.value.warning).toMatch(/not a chest/);
    expect((await call('list_project_entities')).value.objects[0].loot).toEqual(rows);
  });

  it('does not warn for a chest or an NPC', async () => {
    const { call } = await mcpFixture(allTools);
    const npc = (await call('new_entity', { kind: 'npc', name: 'Rellick' })).value.entity.entry;
    const chest = (await call('new_entity', { kind: 'object', name: 'Chest', fields: { type: 'chest' } })).value.entity.entry;
    expect((await call('set_loot', { kind: 'object', entry: chest, rows })).value.warning).toBeUndefined();
    expect((await call('set_loot', { kind: 'npc', entry: npc, rows })).value.warning).toBeUndefined();
  });
});
