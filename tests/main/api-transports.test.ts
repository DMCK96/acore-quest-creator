import { describe, expect, it, vi } from 'vitest';
import { createApi } from '../../src/main/api';
import { openStore } from '../../src/main/store/store';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta } from '../../src/main/project/project-file';
import type { ProjectController } from '../../src/main/project/controller';
import { buildDbc, buildDbcWithStrings, f32 } from '../helpers/dbc';
import { forkDb } from '../helpers/fixtures';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };
const row = (cells: Record<number, number | string>) => Array.from({ length: 66 }, (_, i) => cells[i] ?? 0);
const node = (id: number, path: number, index: number, map: number, x: number, y: number, flags = 0) => [id, path, index, map, f32(x), f32(y), f32(50), flags, 0, 0, 0];

const files: Record<string, Uint8Array> = {
  'DBFilesClient/Map.dbc': buildDbcWithStrings([row({ 0: 591, 1: 'Transport', 2: 0, 5: 'Orgrimmar and Undercity Zeppelin' })], 66),
  'DBFilesClient/TaxiPathNode.dbc': buildDbc([node(1, 302, 0, 1, 1000, -4000), node(2, 302, 1, 1, 1100, -4000, 2)], 11),
};

async function setup(dir: string | null = 'C:/wow', withTemplate = true) {
  const db = forkDb();
  if (withTemplate) {
    db.insert('gameobject_template', { entry: '164871', type: '15', displayId: '3031', name: 'Zeppelin (The Thundercaller)', Data0: '302', Data6: '591' });
    // A passenger: its position is vessel-local, and must never become the map's start
    db.insert('creature_template', { entry: '3', name: 'Zeppelin Master' });
    db.insert('creature', { guid: '1', id1: '3', map: '591', position_x: '3', position_y: '2', position_z: '1' });
  }
  const clientFile = vi.fn(async (path: string) => files[path] ?? null);
  const clientStatus = vi.fn(async () => (dir ? { dir, archives: [], problems: [] } : null));
  const api = createApi({ store: openStore(':memory:', box), openWorldDb: async () => db, openDevDb: async () => { throw new Error('x'); },
    fs: { writeFile: async () => {}, ensureDir: async () => {}, listDir: async () => [] }, now: () => new Date(),
    session: createProjectSession(defaultProjectMeta('P', 'C:\out')), projects: {} as ProjectController, clientFile, clientStatus });
  const rec: any = await api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p' });
  await api.connect(rec.value.id);
  return { api, clientFile };
}

describe('transports in the client\u2019s maps', () => {
  it('lists a transport map starting at its dock, not at a passenger', async () => {
    const { api } = await setup();
    const out: any = await api.clientMaps();
    const m = out.value.find((x: any) => x.id === 591);
    expect(m).toMatchObject({ name: 'Orgrimmar and Undercity Zeppelin', kind: 'transport', directory: 'kalimdor', start: { x: 1100, y: -4000, z: 50 } });
    expect(m.transport.templates[0]).toMatchObject({ entry: 164871, pathId: 302, displayId: 3031 });
  });

  it('reads TaxiPathNode.dbc once per client folder', async () => {
    const { api, clientFile } = await setup();
    await api.clientMaps();
    const reads = clientFile.mock.calls.length;
    await api.clientMaps();
    expect(clientFile.mock.calls.length).toBe(reads);
  });

  it('lists no transports without a client folder, without templates, or without the route file', async () => {
    const noClient: any = await (await setup(null)).api.clientMaps();
    expect(noClient.value).toEqual([]);
    const none: any = await (await setup('C:/wow', false)).api.clientMaps();
    expect(none.value.some((m: any) => m.kind === 'transport')).toBe(false);
    delete files['DBFilesClient/TaxiPathNode.dbc'];
    const missing: any = await (await setup()).api.clientMaps();
    expect(missing.value.some((m: any) => m.kind === 'transport')).toBe(false);
  });
});
