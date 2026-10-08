import { describe, expect, it } from 'vitest';
import { allTools } from '../../src/main/mcp/tools';
import { mcpFixture } from '../helpers/mcp-fixture';

const labels = async (api: any) => (await api.historyList()).value.steps.map((s: any) => s.label);

describe('quest tools', () => {
  it('describe_quest_fields lists every registry field with help text', async () => {
    const { call } = await mcpFixture(allTools);
    const out = await call('describe_quest_fields');
    const title = out.value.find((f: any) => f.id === 'quest_template.LogTitle');
    expect(title.type.kind).toBe('string');
    expect(out.value.every((f: any) => typeof f.help === 'string' && f.help.length > 0)).toBe(true);
    expect(out.value.some((f: any) => f.type?.kind === 'enum' && f.type.options.length > 0)).toBe(true);
  });

  it('new_quest makes one step and returns the quest', async () => {
    const { call, api, changes } = await mcpFixture(allTools);
    const out = await call('new_quest');
    expect(out.value.questId).toBeGreaterThan(0);
    expect(await labels(api)).toEqual(['Claude: new quest']);
    expect(changes).toHaveLength(1);
  });

  it('set_quest_fields edits the project\'s quest as one step and reports what changed', async () => {
    const { call, api, session } = await mcpFixture(allTools);
    const { questId } = (await call('new_quest')).value;
    const out = await call('set_quest_fields', { questId, fields: { 'quest_template.LogTitle': 'Kobold Camp Cleanup', 'quest_template.QuestLevel': 10 } });
    expect(out.isError).toBe(false);
    expect(out.value.changed.sort()).toEqual(['quest_template.LogTitle', 'quest_template.QuestLevel']);
    expect(Array.isArray(out.value.issues)).toBe(true);
    const values = session.quests.get(questId)!.aggregate.values;
    expect(values['quest_template.LogTitle']).toBe('Kobold Camp Cleanup');
    expect(values['quest_template.QuestLevel']).toBe(10);
    expect(await labels(api)).toEqual(['Claude: new quest', `Claude: edit quest ${questId}`]);
  });

  it('set_quest_fields refuses unknown ids and wrong types together, and changes nothing', async () => {
    const { call, api } = await mcpFixture(allTools);
    const { questId } = (await call('new_quest')).value;
    const out = await call('set_quest_fields', { questId, fields: { 'quest_template.NoSuchField': 1, 'quest_template.LogTitle': 5 } });
    expect(out.isError).toBe(true);
    expect(out.value.code).toBe('BAD_REQUEST');
    expect(out.value.message).toMatch(/NoSuchField/);
    expect(out.value.message).toMatch(/LogTitle|Title/);
    expect(await labels(api)).toEqual(['Claude: new quest']);
  });

  it('set_quest_fields refuses a field the quest cannot edit', async () => {
    const { call, api, session } = await mcpFixture(allTools);
    const { questId } = (await call('new_quest')).value;
    const quest = session.quests.get(questId)!;
    session.quests.put({ ...quest, aggregate: { ...quest.aggregate, readOnly: [{ fieldId: 'quest_template.LogTitle', reason: 'stored text has no representation' }] } }, { quiet: true });
    const out = await call('set_quest_fields', { questId, fields: { 'quest_template.LogTitle': 'x' } });
    expect(out.isError).toBe(true);
    expect(out.value.message).toMatch(/stored text has no representation/);
    expect(await labels(api)).toEqual(['Claude: new quest']);
  });

  it('set_quest_fields on a quest that is not in the project says to open it first', async () => {
    const { call } = await mcpFixture(allTools);
    const out = await call('set_quest_fields', { questId: 99999, fields: { 'quest_template.LogTitle': 'x' } });
    expect(out.value.code).toBe('QUEST_NOT_FOUND');
    expect(out.value.message).toMatch(/get_quest/);
  });

  it('setting a field to the value it already has makes no step', async () => {
    const { call, api } = await mcpFixture(allTools);
    const { questId } = (await call('new_quest')).value;
    await call('set_quest_fields', { questId, fields: { 'quest_template.LogTitle': 'Same' } });
    const again = await call('set_quest_fields', { questId, fields: { 'quest_template.LogTitle': 'Same' } });
    expect(again.value.changed).toEqual([]);
    expect((await labels(api)).length).toBe(2);
  });

  it('get_quest imports a database quest once and labels the step', async () => {
    const { call, api, db } = await mcpFixture(allTools);
    db.insert('quest_template', { ID: '33', LogTitle: 'Kobold Camp Cleanup', QuestLevel: '10' });
    const first = await call('get_quest', { questId: 33 });
    expect(first.value.inProject).toBe(false);
    expect(first.value.aggregate.values['quest_template.LogTitle']).toBe('Kobold Camp Cleanup');
    const again = await call('get_quest', { questId: 33 });
    expect(again.value.inProject).toBe(true);
    expect(await labels(api)).toEqual(['Claude: open quest 33']);
  });

  it('list_quests, validate_quest, quest_links and remove_quest work on the project\'s quests', async () => {
    const { call, api } = await mcpFixture(allTools);
    const { questId } = (await call('new_quest')).value;
    const listed = await call('list_quests');
    expect(listed.value.map((q: any) => q.questId)).toEqual([questId]);
    expect(Array.isArray((await call('validate_quest', { questId })).value)).toBe(true);
    expect((await call('quest_links', { questIds: [questId] })).isError).toBe(false);
    await call('remove_quest', { questId });
    expect((await call('list_quests')).value).toEqual([]);
    expect((await labels(api)).at(-1)).toBe(`Claude: remove quest ${questId}`);
  });
});
