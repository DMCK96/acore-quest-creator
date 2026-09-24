import { describe, expect, it } from 'vitest';
import { createApi } from '../../src/main/api';
import { openStore } from '../../src/main/store/store';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta } from '../../src/main/project/project-file';
import type { ProjectController } from '../../src/main/project/controller';
import type { ServerDataFiles } from '../../src/main/server-data';
import { FakeWorldDb } from '../helpers/fake-world-db';
import { buildMapFile } from '../helpers/map-file';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };
const files: ServerDataFiles = {
  isDir: async (d) => d === '/data',
  read: async (d, name) => (d.replace(/\\/g, '/') === '/data/maps' && name === '0004832.map' ? buildMapFile({ kind: 'flat', gridHeight: 80.456 }) : null),
};

async function apiWith(dbcDir: string) {
  const api = createApi({ store: openStore(':memory:', box), openWorldDb: async () => FakeWorldDb.fromFork(['quest_template']), openDevDb: async () => { throw new Error('x'); },
    fs: { writeFile: async () => {}, ensureDir: async () => {}, listDir: async () => [] }, now: () => new Date(),
    session: createProjectSession(defaultProjectMeta('P', 'C:\\out')), projects: {} as ProjectController, serverDataFiles: files });
  const rec: any = await api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p', dbcDir });
  await api.connect(rec.value.id);
  return api;
}

describe('groundHeight', () => {
  it('reads the ground height from the map file under the server data folder', async () => {
    const out: any = await (await apiWith('/data')).groundHeight(0, -8913.2, -136.5);
    expect(out.value).toEqual({ z: 80.46 });
  });
  it('explains why there is no height', async () => {
    expect(((await (await apiWith('')).groundHeight(0, 1, 1)) as any).value.reason).toMatch(/server data folder/);
    expect(((await (await apiWith('/data')).groundHeight(1, 1, 1)) as any).value.reason).toMatch(/No map file/);
  });
});
