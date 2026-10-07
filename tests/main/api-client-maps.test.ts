import { describe, expect, it, vi } from 'vitest';
import { createApi } from '../../src/main/api';
import { openStore } from '../../src/main/store/store';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta } from '../../src/main/project/project-file';
import type { ProjectController } from '../../src/main/project/controller';
import { buildDbcWithStrings } from '../helpers/dbc';
import { forkDb } from '../helpers/fixtures';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };
const row = (cells: Record<number, number | string>) => Array.from({ length: 66 }, (_, i) => cells[i] ?? 0);

function wdt(tiles: [number, number][]): Uint8Array {
  const chunk = (tag: string, body: Uint8Array): number[] => {
    const head = new Uint8Array(8);
    [...tag].reverse().forEach((c, i) => (head[i] = c.charCodeAt(0)));
    new DataView(head.buffer).setUint32(4, body.length, true);
    return [...head, ...body];
  };
  const main = new Uint8Array(64 * 64 * 8);
  for (const [a, b] of tiles) new DataView(main.buffer).setUint32((b * 64 + a) * 8, 1, true);
  return Uint8Array.from([...chunk('MVER', new Uint8Array(4)), ...chunk('MPHD', new Uint8Array(32)), ...chunk('MAIN', main)]);
}

const mapDbc = buildDbcWithStrings([row({ 0: 631, 1: 'IcecrownCitadel', 2: 2, 5: 'Icecrown Citadel' }), row({ 0: 36, 1: 'Deadmines', 2: 1, 5: 'Deadmines' })], 66);
const files: Record<string, Uint8Array> = {
  'DBFilesClient/Map.dbc': mapDbc,
  'world/maps/IcecrownCitadel/IcecrownCitadel.wdt': wdt([[26, 23]]),
  'world/maps/Deadmines/Deadmines.wdt': wdt([[30, 30]]),
};

async function setup(dir: string | null = 'C:/wow') {
  const db = forkDb();
  db.insert('creature_template', { entry: '36612', name: 'Lord Marrowgar' });
  db.insert('creature', { guid: '1', id1: '36612', map: '631', position_x: '-390', position_y: '2210', position_z: '42' });
  const clientFile = vi.fn(async (path: string) => files[path] ?? null);
  const clientStatus = vi.fn(async () => (dir ? { dir, archives: [], problems: [] } : null));
  const api = createApi({ store: openStore(':memory:', box), openWorldDb: async () => db, openDevDb: async () => { throw new Error('x'); },
    fs: { writeFile: async () => {}, ensureDir: async () => {}, listDir: async () => [] }, now: () => new Date(),
    session: createProjectSession(defaultProjectMeta('P', 'C:\out')), projects: {} as ProjectController, clientFile, clientStatus });
  const rec: any = await api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p' });
  await api.connect(rec.value.id);
  return { api, clientFile };
}

describe('the client\u2019s maps', () => {
  it('lists the maps the client has terrain for, each starting at a spawn when the database has one there', async () => {
    const { api } = await setup();
    const out: any = await api.clientMaps();
    const byId = new Map(out.value.map((m: any) => [m.id, m]));
    expect((byId.get(631) as any).start).toEqual({ x: -390, y: 2210, z: 42 });
    // No spawn on map 36: the middle of its tile
    expect((byId.get(36) as any).start.z).toBe(0);
    expect((byId.get(631) as any)).toMatchObject({ name: 'Icecrown Citadel', directory: 'IcecrownCitadel', kind: 'raid' });
  });

  it('reads the client once per folder', async () => {
    const { api, clientFile } = await setup();
    await api.clientMaps();
    const reads = clientFile.mock.calls.length;
    await api.clientMaps();
    expect(clientFile.mock.calls.length).toBe(reads);
  });

  it('lists none without a client folder', async () => {
    const { api } = await setup(null);
    expect(((await api.clientMaps()) as any).value).toEqual([]);
  });
});
