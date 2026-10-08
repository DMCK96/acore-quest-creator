import { describe, expect, it } from 'vitest';
import { allTools } from '../../src/main/mcp/tools';
import { mcpFixture } from '../helpers/mcp-fixture';

const labels = async (api: any) => (await api.historyList()).value.steps.map((s: any) => s.label);
const scene = (over: Record<string, unknown> = {}) => ({
  name: 'Greeting', owner: { kind: 'creature', entry: 295 }, trigger: { kind: 'questAccepted' }, gates: [],
  steps: [{ kind: 'say', text: 'Hello, $N.', style: 'say', waitMs: 0 }], ...over,
});

async function withQuest() {
  const fx = await mcpFixture(allTools);
  const { questId } = (await fx.call('new_quest')).value;
  return { ...fx, questId };
}

describe('describe_authoring', () => {
  it('returns the schema, guide and examples of a model, and changes nothing', async () => {
    const { call, order } = await mcpFixture(allTools);
    const out = await call('describe_authoring', { model: 'scene' });
    expect(out.isError).toBe(false);
    expect(JSON.stringify(out.value.jsonSchema)).toContain('startEscort');
    expect(out.value.guide).toContain('questAccepted');
    expect(out.value.examples.length).toBeGreaterThan(5);
    expect(out.value.examples.every((e: any) => e.reading.length > 0)).toBe(true);
    expect(order).toEqual([]);
  });

  it('refuses a model it does not know', async () => {
    const { call } = await mcpFixture(allTools);
    expect((await call('describe_authoring', { model: 'spaceship' })).isError).toBe(true);
  });
});

describe('set_scene', () => {
  it('adds scenes with ids it assigns, as one AI step each', async () => {
    const { call, api, questId } = await withQuest();
    const first = await call('set_scene', { questId, scene: scene() });
    expect(first.isError).toBe(false);
    expect(first.value.sceneId).toBe('s1');
    const second = await call('set_scene', { questId, scene: scene({ name: 'Farewell' }) });
    expect(second.value.sceneId).toBe('s2');
    expect(await labels(api)).toEqual(['AI: new quest', `AI: set scene of quest ${questId}`, `AI: set scene of quest ${questId}`]);
    const read = await call('get_scenes', { questId });
    expect(read.value.scenes.map((s: any) => s.scene.id)).toEqual(['s1', 's2']);
  });

  it('replaces the scene with the same id instead of adding another', async () => {
    const { call, questId } = await withQuest();
    await call('set_scene', { questId, scene: scene() });
    const out = await call('set_scene', { questId, scene: scene({ id: 's1', name: 'Greeting v2' }) });
    expect(out.value.sceneId).toBe('s1');
    const read = await call('get_scenes', { questId });
    expect(read.value.scenes).toHaveLength(1);
    expect(read.value.scenes[0].scene.name).toBe('Greeting v2');
  });

  it('labels the step with the id when one is given', async () => {
    const { call, api, questId } = await withQuest();
    await call('set_scene', { questId, scene: scene({ id: 's7' }) });
    expect((await labels(api)).at(-1)).toBe(`AI: set scene s7 of quest ${questId}`);
  });

  it("does not hand out the id of a removed scene while a later scene still stands (the editor's own rule)", async () => {
    const { call, questId } = await withQuest();
    await call('set_scene', { questId, scene: scene() });
    await call('set_scene', { questId, scene: scene({ name: 'Second' }) });
    await call('remove_scene', { questId, sceneId: 's1' });
    const third = await call('set_scene', { questId, scene: scene({ name: 'Third' }) });
    expect(third.value.sceneId).toBe('s3');
  });

  it('refuses a scene with a wrong kind, saying where, and leaves no step', async () => {
    const { call, api, questId } = await withQuest();
    const out = await call('set_scene', { questId, scene: scene({ trigger: { kind: 'nope' } }) });
    expect(out.isError).toBe(true);
    expect(out.value.code).toBe('BAD_REQUEST');
    expect(out.value.message).toMatch(/Nothing was changed/);
    expect(out.value.message).toMatch(/trigger/);
    expect(await labels(api)).toEqual(['AI: new quest']);
  });

  it('refuses a scene whose step has the wrong type', async () => {
    const { call, questId } = await withQuest();
    const out = await call('set_scene', { questId, scene: scene({ steps: [{ kind: 'say', text: 5, style: 'say', waitMs: 0 }] }) });
    expect(out.isError).toBe(true);
    expect(out.value.message).toMatch(/steps\.0\.text/);
  });

  it("accepts an unfinished scene and hands back the editor's issues about it", async () => {
    const { call, questId } = await withQuest();
    const out = await call('set_scene', { questId, scene: scene({ steps: [{ kind: 'say', text: '', style: 'say', waitMs: 0 }] }) });
    expect(out.isError).toBe(false);
    expect(out.value.issues.some((i: any) => /Scene/.test(i.message))).toBe(true);
  });

  it('says to open a quest that is not in the project first', async () => {
    const { call } = await mcpFixture(allTools);
    const out = await call('set_scene', { questId: 99999, scene: scene() });
    expect(out.value.code).toBe('QUEST_NOT_FOUND');
    expect(out.value.message).toMatch(/get_quest/);
  });

  it('is taken back by undo as one step', async () => {
    const { call, questId } = await withQuest();
    await call('set_scene', { questId, scene: scene() });
    await call('undo');
    expect((await call('get_scenes', { questId })).value.scenes).toEqual([]);
  });
});

describe('remove_scene and get_scenes', () => {
  it('removes only the scene named, and names the ids that exist when the id is wrong', async () => {
    const { call, questId } = await withQuest();
    await call('set_scene', { questId, scene: scene() });
    await call('set_scene', { questId, scene: scene({ name: 'Second' }) });
    const gone = await call('remove_scene', { questId, sceneId: 's1' });
    expect(gone.value.removed).toBe('s1');
    expect((await call('get_scenes', { questId })).value.scenes.map((s: any) => s.scene.id)).toEqual(['s2']);
    const wrong = await call('remove_scene', { questId, sceneId: 's9' });
    expect(wrong.isError).toBe(true);
    expect(wrong.value.message).toMatch(/s2/);
  });

  it('get_scenes reads each scene aloud', async () => {
    const { call, questId } = await withQuest();
    await call('set_scene', { questId, scene: scene() });
    const out = await call('get_scenes', { questId });
    expect(out.value.scenes[0].reading).toMatch(/Hello/);
    expect(Array.isArray(out.value.issues)).toBe(true);
  });
});

describe('set_quest_fields and scenes', () => {
  it('points at set_scene when asked to set the scripts field', async () => {
    const { call, questId } = await withQuest();
    const out = await call('set_quest_fields', { questId, fields: { scripts: [] } });
    expect(out.isError).toBe(true);
    expect(out.value.message).toMatch(/set_scene/);
  });
});

describe('scene ids', () => {
  const scene = (over: Record<string, unknown> = {}) => ({
    name: 'Greeting', owner: { kind: 'creature', entry: 295 }, trigger: { kind: 'questAccepted' }, gates: [],
    steps: [{ kind: 'say', text: 'Hello, $N.', style: 'say', waitMs: 0 }], ...over,
  });

  it('refuses an id that is not s followed by a number, because export would not recognise its rows', async () => {
    const { call, api } = await mcpFixture(allTools);
    const { questId } = (await call('new_quest')).value;
    const out = await call('set_scene', { questId, scene: scene({ id: 'intro boss' }) });
    expect(out.isError).toBe(true);
    expect(out.value.code).toBe('BAD_REQUEST');
    expect(out.value.message).toMatch(/s<number>|s1/);
    expect(((await api.historyList()) as any).value.steps.map((s: any) => s.label)).toEqual(['AI: new quest']);
  });

  it('accepts s12', async () => {
    const { call } = await mcpFixture(allTools);
    const { questId } = (await call('new_quest')).value;
    expect((await call('set_scene', { questId, scene: scene({ id: 's12' }) })).value.sceneId).toBe('s12');
  });
});
