import { describe, expect, it } from 'vitest';
import { createApi } from '../../src/main/api';
import { openStore } from '../../src/main/store/store';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta } from '../../src/main/project/project-file';
import type { ProjectController } from '../../src/main/project/controller';
import { forkDb } from '../helpers/fixtures';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };
async function setup() {
  const db = forkDb();
  db.insert('creature_template', { entry: '1423', name: 'Stormwind Guard' });
  db.insert('creature', { guid: '80330', id1: '1423', map: '0', position_x: '-9481.31', position_y: '74.42', position_z: '56.55', orientation: '1.5' });
  const session = createProjectSession(defaultProjectMeta('P', 'C:\\out'));
  const api = createApi({ store: openStore(':memory:', box), openWorldDb: async () => db, openDevDb: async () => { throw new Error('x'); },
    fs: { writeFile: async () => {}, ensureDir: async () => {}, listDir: async () => [] },
    now: () => new Date('2026-10-04T12:00:00Z'), session, projects: {} as ProjectController });
  const rec: any = await api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p' });
  await api.connect(rec.value.id);
  return { api, db, session };
}
const at = (x: number) => ({ x, y: 74.42, z: 56.55, orientation: 2, rotation: null });

describe('undo and redo through the API', () => {
  it('undoes a quest edit and hands back the quest as it now is, labelled', async () => {
    const { api } = await setup();
    const created: any = await api.newQuest();
    const id = created.value.questId;
    const aggregate = { ...created.value.aggregate, values: { ...created.value.aggregate.values, 'quest_template.LogTitle': 'Kobold Camp Cleanup' } };
    await api.updateQuest(aggregate);
    const out: any = await api.historyUndo();
    expect(out.value.direction).toBe('undo');
    expect(out.value.step.label).toMatch(/of Kobold Camp Cleanup$/);
    expect(out.value.quests).toEqual([{ questId: id, aggregate: created.value.aggregate }]);
    expect(out.value.history.steps.map((s: any) => s.label)).toEqual([`New quest ${id}`, out.value.step.label]);
    const back: any = await api.historyUndo();
    expect(back.value.quests).toEqual([{ questId: id, aggregate: null }]);
    const redo: any = await api.historyRedo();
    expect(redo.value.quests[0].aggregate).toEqual(created.value.aggregate);
  });

  it('undoes a world edit and returns the layer', async () => {
    const { api } = await setup();
    await api.worldMoveSpawn('creature', 80330, at(-9470));
    const out: any = await api.historyUndo();
    expect(out.value.world).toEqual({ spawns: [], routes: [], added: [], movements: [] });
    expect(out.value.step.label).toBe('Moved Stormwind Guard');
  });

  it('groups calls between begin and end into one step', async () => {
    const { api } = await setup();
    const token: any = await api.historyBegin('Move 2 things');
    await api.worldMoveSpawn('creature', 80330, at(-9470));
    await api.newQuest();
    await api.historyEnd(token.value);
    const list: any = await api.historyList();
    expect(list.value.steps.map((s: any) => s.label)).toEqual(['Move 2 things']);
  });

  it('adding a quest chain is one step, however many quests it adds', async () => {
    const { api, db } = await setup();
    db.insert('quest_template', { ID: '33', LogTitle: 'First' });
    db.insert('quest_template', { ID: '34', LogTitle: 'Second' });
    db.insert('quest_template_addon', { ID: '34', PrevQuestID: '33' });
    await api.addQuestChain(33);
    const list: any = await api.historyList();
    expect(list.value.steps.map((s: any) => s.label)).toEqual(['Added a chain of 2 quests']);
    const undo: any = await api.historyUndo();
    expect(undo.value.quests.map((q: any) => q.aggregate)).toEqual([null, null]);
  });

  it('skips, with its reason, a placed spawn whose id the database has taken before the redo', async () => {
    const { api, db } = await setup();
    const placed: any = await api.worldAddSpawn('creature', 1423, 0, at(-9400));
    const guid = placed.value.guid;
    await api.worldMoveSpawn('creature', 80330, at(-9470));
    await api.historyJump(0);
    db.insert('creature', { guid: String(guid), id1: '1423', map: '0', position_x: '0', position_y: '0', position_z: '0', orientation: '0' });
    const redo: any = await api.historyRedo();
    expect(redo.value.skipped).toEqual([`Could not redo: spawn ${guid} is now in the database`]);
    expect(redo.value.world.added).toEqual([]);
    const next: any = await api.historyRedo();
    expect(next.value.world.spawns).toHaveLength(1);
    const undo: any = await api.historyUndo();
    expect(undo.ok).toBe(true);
  });

  it('jumps back several steps at once, returning every quest they touched', async () => {
    const { api } = await setup();
    const a: any = await api.newQuest();
    const b: any = await api.newQuest();
    const out: any = await api.historyJump(0);
    expect(out.value.quests.map((q: any) => [q.questId, q.aggregate])).toEqual(expect.arrayContaining([[a.value.questId, null], [b.value.questId, null]]));
    expect(out.value.history.current).toBe(0);
  });

  it('with nothing to undo answers with no step', async () => {
    const { api } = await setup();
    const out: any = await api.historyUndo();
    expect(out.value.step).toBeNull();
  });

  it('ends a step left open before undoing', async () => {
    const { api } = await setup();
    await api.historyBegin('Left open');
    await api.worldMoveSpawn('creature', 80330, at(-9470));
    const out: any = await api.historyUndo();
    expect(out.value.step.label).toBe('Left open');
    expect(out.value.world.spawns).toEqual([]);
  });
});
