// tests/main/api-sounds.test.ts
import { describe, expect, it } from 'vitest';
import { createApi } from '../../src/main/api';
import { openStore } from '../../src/main/store/store';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta } from '../../src/main/project/project-file';
import type { ProjectController } from '../../src/main/project/controller';
import type { ServerDataFiles } from '../../src/main/server-data';
import { buildDbcWithStrings } from '../helpers/dbc';
import { forkDb } from '../helpers/fixtures';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };
const row = (id: number, name: string) => { const r: (number | string)[] = Array(30).fill(0); r[0] = id; r[2] = name; return r; };
const files: ServerDataFiles = {
  isDir: async (d) => d === '/data',
  read: async (d, name) => (d.replace(/\\/g, '/') === '/data/dbc' && name === 'SoundEntries.dbc' ? buildDbcWithStrings([row(12, 'GuardAlarm')], 30) : null),
};

describe('sounds through the API', () => {
  it('searches and names sounds from the server data folder', async () => {
    const api = createApi({ store: openStore(':memory:', box), openWorldDb: async () => forkDb(), openDevDb: async () => { throw new Error('x'); },
      fs: { writeFile: async () => {}, ensureDir: async () => {}, listDir: async () => [] }, now: () => new Date(),
      session: createProjectSession(defaultProjectMeta('P', 'C:\\out')), projects: {} as ProjectController, serverDataFiles: files });
    const rec: any = await api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p', dbcDir: '/data/dbc' });
    await api.connect(rec.value.id);
    expect(((await api.searchEntities('sound', 'guard')) as any).value).toEqual([{ id: 12, name: 'GuardAlarm' }]);
    expect(((await api.lookupNames('sound', [12, 13])) as any).value).toEqual({ 12: 'GuardAlarm' });
  });
});
