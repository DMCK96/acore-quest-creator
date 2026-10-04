import { describe, expect, it } from 'vitest';
import { createApi } from '../../src/main/api';
import { openStore } from '../../src/main/store/store';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta } from '../../src/main/project/project-file';
import type { ProjectController } from '../../src/main/project/controller';
import { EMPTY_ENTITIES, newNpc, newSpawn } from '../../src/core/entities/model';
import { forkDb } from '../helpers/fixtures';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };
async function setup() {
  const db = forkDb();
  const written = new Map<string, string>();
  const executed: string[][] = [];
  const session = createProjectSession(defaultProjectMeta('P', 'C:\\out'));
  const api = createApi({ store: openStore(':memory:', box), openWorldDb: async () => db,
    openDevDb: async () => ({ execute: async (sql: string[]) => { executed.push(sql); }, close: async () => {} }) as any,
    fs: { writeFile: async (p: string, t: string) => { written.set(p, t); }, ensureDir: async () => {}, listDir: async () => [...written.keys()].map((p) => p.split('\\').at(-1)!) },
    now: () => new Date('2026-10-04T12:00:00Z'), session, projects: {} as ProjectController, exportDirOverride: 'C:\\out' } as any);
  const rec: any = await api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p' });
  await api.connect(rec.value.id);
  await api.saveProfile({ name: 'd', role: 'dev', host: 'h', port: 1, user: 'u', database: 'dev', password: 'p' });
  return { api, written, executed, session };
}
const hela = { ...newNpc(12000001), name: 'Hela', displayId: 1, spawns: [newSpawn(6000001)] };

async function questGivenBy(api: any, entry: number): Promise<any> {
  const opened: any = await api.newQuest();
  const aggregate = opened.value.aggregate;
  aggregate.values['quest_template.LogTitle'] = 'Hela\'s errand';
  aggregate.values.creature_queststarter = [{ id: entry }];
  aggregate.values.creature_questender = [{ id: entry }];
  await api.updateQuest(aggregate);
  return aggregate;
}

describe('the project patch', () => {
  it('writes every project NPC, with a revert that deletes it, to _project.sql', async () => {
    const { api, written } = await setup();
    await api.putProjectEntities({ ...EMPTY_ENTITIES, npcs: [hela] });
    const out: any = await api.exportProject();
    expect(out.ok).toBe(true);
    expect(out.value.applyPath).toMatch(/_00_project\.sql$/);
    expect(out.value.revertPath).toMatch(/_00_project_revert\.sql$/);
    expect(out.value.sql).toContain("'Hela'");
    expect(out.value.sql).toContain('AQC npc12000001 ');
    expect(written.get(out.value.revertPath)).toMatch(/DELETE FROM `creature_template` WHERE[\s\S]*12000001/);
  });

  it('says there is nothing to export with no entities and no world edits', async () => {
    const { api } = await setup();
    const out: any = await api.exportProject();
    expect(out.error.message).toBe('There are no NPCs, objects, items or world changes to export.');
  });

  it('a quest patch holds quest rows only and counts the project entities it uses', async () => {
    const { api } = await setup();
    const aggregate = await questGivenBy(api, 12000001);
    await api.putProjectEntities({ ...EMPTY_ENTITIES, npcs: [hela] });
    const out: any = await api.exportQuest(aggregate.questId);
    expect(out.ok).toBe(true);
    expect(out.value.sql).not.toContain('INSERT INTO `creature_template`');
    expect(out.value.usesProject).toBe(1);
    expect(out.value.projectSql).toContain('INSERT INTO `creature_template`');
  });

  it('apply to dev runs the project patch, then the quest', async () => {
    const { api, executed } = await setup();
    const aggregate = await questGivenBy(api, 12000001);
    await api.putProjectEntities({ ...EMPTY_ENTITIES, npcs: [hela] });
    const out: any = await api.applyToDev(aggregate.questId, true);
    expect(out.ok).toBe(true);
    const all = executed.flat();
    const npcAt = all.findIndex((s) => s.includes('INSERT INTO `creature_template`'));
    const questAt = all.findIndex((s) => s.includes('INSERT INTO `quest_template`'));
    expect(npcAt).toBeGreaterThanOrEqual(0);
    expect(questAt).toBeGreaterThan(npcAt);
  });
});
