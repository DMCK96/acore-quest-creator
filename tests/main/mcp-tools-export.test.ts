import { describe, expect, it } from 'vitest';
import { allTools } from '../../src/main/mcp/tools';
import { mcpFixture } from '../helpers/mcp-fixture';

const FINISHED = { 'quest_template.LogTitle': 'Kobold Camp Cleanup', 'quest_template.QuestLevel': 10 };

describe('export tools', () => {
  it('preview_changes and test_commands answer for a project quest', async () => {
    const { call } = await mcpFixture(allTools);
    const { questId } = (await call('new_quest')).value;
    expect((await call('preview_changes', { questId })).isError).toBe(false);
    expect((await call('test_commands', { questId })).isError).toBe(false);
  });

  it('export_quest refuses an untitled quest with the validation issues, so the model can fix them', async () => {
    const { call } = await mcpFixture(allTools);
    const { questId } = (await call('new_quest')).value;
    const out = await call('export_quest', { questId });
    expect(out.isError).toBe(true);
    expect(out.value.code).toBe('VALIDATION');
    expect(out.value.issues.some((i: any) => i.code === 'NO_TITLE')).toBe(true);
  });

  it('export_quest writes a patch for a finished quest and asks the window to reload the canvas', async () => {
    const { call, changes } = await mcpFixture(allTools);
    const { questId } = (await call('new_quest')).value;
    await call('set_quest_fields', { questId, fields: FINISHED });
    const out = await call('export_quest', { questId });
    expect(out.isError).toBe(false);
    expect(out.value.sql).toMatch(/INSERT INTO `quest_template`/);
    expect(out.value.path).toMatch(/kobold_camp_cleanup\.sql$/);
    expect(changes.at(-1)!.positions).toBe(true);
  });

  it('export_project writes the project patch and its revert', async () => {
    const { call } = await mcpFixture(allTools);
    await call('add_spawn', { kind: 'creature', entry: 1423, map: 0, x: -9470, y: 74, z: 56, orientation: 1 });
    const out = await call('export_project');
    expect(out.isError).toBe(false);
    expect(out.value.applyPath).toBeTruthy();
    expect(out.value.revertPath).toBeTruthy();
  });
});

describe('undo and redo through MCP', () => {
  it('undoes a Claude edit, tells the window, and redo puts it back', async () => {
    const { call, changes, session } = await mcpFixture(allTools);
    const { questId } = (await call('new_quest')).value;
    await call('set_quest_fields', { questId, fields: { 'quest_template.LogTitle': 'Kobold Camp Cleanup' } });
    const undone = await call('undo');
    expect(undone.isError).toBe(false);
    expect(undone.value.undid).toBe(`Claude: edit quest ${questId}`);
    expect(changes.at(-1)!.direction).toBe('undo');
    expect(session.quests.get(questId)!.aggregate.values['quest_template.LogTitle']).not.toBe('Kobold Camp Cleanup');
    const redone = await call('redo');
    expect(redone.value.redid).toBe(`Claude: edit quest ${questId}`);
    expect(session.quests.get(questId)!.aggregate.values['quest_template.LogTitle']).toBe('Kobold Camp Cleanup');
  });

  it('answers undo with undid null when there is nothing to undo', async () => {
    const { call } = await mcpFixture(allTools);
    expect((await call('undo')).value.undid).toBeNull();
  });
});
