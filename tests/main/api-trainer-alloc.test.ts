import { describe, expect, it } from 'vitest';
import { createApi } from '../../src/main/api';
import { openStore } from '../../src/main/store/store';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta } from '../../src/main/project/project-file';
import type { ProjectController } from '../../src/main/project/controller';
import { newNpc } from '../../src/core/entities/model';
import { parseRequest } from '../../src/shared/ipc';
import { forkDb } from '../helpers/fixtures';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };

async function setup() {
  const db = forkDb();
  db.insert('trainer', { Id: '900032', Type: '0', Requirement: '1', Greeting: '', VerifiedBuild: '0' });
  const api = createApi({ store: openStore(':memory:', box), openWorldDb: async () => db, openDevDb: async () => { throw new Error('x'); },
    fs: { writeFile: async () => {}, ensureDir: async () => {}, listDir: async () => [] }, now: () => new Date(),
    session: createProjectSession(defaultProjectMeta('P', 'C:/out')), projects: {} as ProjectController });
  const rec: any = await api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p' });
  await api.connect(rec.value.id);
  return api;
}

describe('trainer ids', () => {
  it('are allocated above the database and the project', async () => {
    const api = await setup();
    expect(((await api.allocateIds('trainer', 2)) as any).value).toEqual([900033, 900034]);
    await api.putProjectEntities({ npcs: [{ ...newNpc(90001), name: 'T', displayId: 1, trainer: { trainerId: 900040, type: 'class', requirement: 1, greeting: '', spells: [] } }], objects: [], items: [] });
    expect(((await api.allocateIds('trainer', 1)) as any).value).toEqual([900041]);
  });

  it('are allocated above a trainer id an NPC points at even when the trainer row is missing', async () => {
    const db = forkDb();
    db.insert('creature_default_trainer', { CreatureId: '555', TrainerId: '900100' });
    const api = createApi({ store: openStore(':memory:', box), openWorldDb: async () => db, openDevDb: async () => { throw new Error('x'); },
      fs: { writeFile: async () => {}, ensureDir: async () => {}, listDir: async () => [] }, now: () => new Date(),
      session: createProjectSession(defaultProjectMeta('P', 'C:/out')), projects: {} as ProjectController });
    const rec: any = await api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p' });
    await api.connect(rec.value.id);
    expect(((await api.allocateIds('trainer', 1)) as any).value).toEqual([900101]);
  });

  it('are accepted over IPC', () => {
    expect(parseRequest('allocateIds', ['trainer', 1]).ok).toBe(true);
    expect(parseRequest('allocateIds', ['nonsense', 1]).ok).toBe(false);
  });
});
