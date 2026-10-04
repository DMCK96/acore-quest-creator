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
  db.insert('creature_template', { entry: '11000230', name: 'Amalgam' });
  db.insert('creature', { guid: '5300681', id1: '11000230' });
  const session = createProjectSession(defaultProjectMeta('P', 'C:\out'));
  const api = createApi({ store: openStore(':memory:', box), openWorldDb: async () => db, openDevDb: async () => { throw new Error('x'); },
    fs: { writeFile: async () => {}, ensureDir: async () => {}, listDir: async () => [] }, now: () => new Date('2026-10-04T00:00:00Z'), session, projects: {} as ProjectController });
  const rec: any = await api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p' });
  await api.connect(rec.value.id);
  return { api, db, session };
}
const hela = { ...newNpc(11000240), name: 'Hela', displayId: 1, spawns: [newSpawn(5300700)] };

describe('the project store through the API', () => {
  it('reads and writes the store, and a write is an undo step', async () => {
    const { api, session } = await setup();
    expect(((await api.projectEntities()) as any).value).toEqual(EMPTY_ENTITIES);
    await api.putProjectEntities({ ...EMPTY_ENTITIES, npcs: [hela] });
    expect(session.entities.get().npcs[0]!.name).toBe('Hela');
    const undone: any = await api.historyUndo();
    expect(undone.value.entities).toEqual(EMPTY_ENTITIES);
  });

  it('refuses a store that is not valid', async () => {
    const { api } = await setup();
    const out: any = await api.putProjectEntities({ npcs: [{ entry: 'x' }], objects: [], items: [] } as any);
    expect(out.ok).toBe(false);
    expect(out.error.message).toBe('The NPCs, objects and items sent are not valid.');
  });

  it('allocates above the store\'s ids', async () => {
    const { api } = await setup();
    await api.putProjectEntities({ ...EMPTY_ENTITIES, npcs: [hela] });
    expect(((await api.allocateIds('creature', 1)) as any).value).toEqual([11000241]);
    expect(((await api.allocateIds('creatureSpawn', 1)) as any).value).toEqual([5300701]);
  });

  it('a redo leaves out an NPC whose entry the database has taken since, and says why', async () => {
    const { api, db, session } = await setup();
    await api.putProjectEntities({ ...EMPTY_ENTITIES, npcs: [hela] });
    await api.historyUndo();
    db.insert('creature_template', { entry: '11000240', name: 'Someone else' });
    const redone: any = await api.historyRedo();
    expect(session.entities.get().npcs).toEqual([]);
    expect(redone.value.skipped).toEqual(['Hela was left out: its ID is now used in the database.']);
  });

  it('a quest\'s spawn list reads the NPCs the quest uses from the store', async () => {
    const { api } = await setup();
    const opened: any = await api.newQuest();
    await api.putProjectEntities({ ...EMPTY_ENTITIES, npcs: [{ ...hela, madeFor: opened.value.questId }] });
    const groups: any = await api.questSpawnList([opened.value.questId]);
    expect(groups.value[0].spawns).toEqual([expect.objectContaining({ guid: 5300700, entry: 11000240, role: 'own' })]);
    expect(opened.value.aggregate.values).not.toHaveProperty('entities');
  });
});
