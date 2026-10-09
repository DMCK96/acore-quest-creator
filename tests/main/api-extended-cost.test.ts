import { describe, expect, it } from 'vitest';
import { createApi } from '../../src/main/api';
import { openStore } from '../../src/main/store/store';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta } from '../../src/main/project/project-file';
import type { ProjectController } from '../../src/main/project/controller';
import type { ServerDataFiles } from '../../src/main/server-data';
import { buildDbc, costRecord } from '../helpers/dbc';
import { forkDb } from '../helpers/fixtures';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };
const files: ServerDataFiles = {
  isDir: async (d) => d === '/data',
  read: async (d, name) => (d.replace(/\\/g, '/') === '/data/dbc' && name === 'ItemExtendedCost.dbc' ? buildDbc([costRecord(1, 2000, 0, [[20559, 1]])]) : null),
};

async function setup(dbcDir: string) {
  const db = forkDb();
  db.insert('item_template', { entry: '20559', name: 'Mark of Honor', displayid: '1', class: '12', subclass: '0', InventoryType: '0', BuyPrice: '12050' });
  const api = createApi({ store: openStore(':memory:', box), openWorldDb: async () => db, openDevDb: async () => { throw new Error('x'); },
    fs: { writeFile: async () => {}, ensureDir: async () => {}, listDir: async () => [] }, now: () => new Date(),
    session: createProjectSession(defaultProjectMeta('P', 'C:\out')), projects: {} as ProjectController, serverDataFiles: files });
  const rec: any = await api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p', dbcDir });
  await api.connect(rec.value.id);
  return api;
}

describe('extended costs through the API', () => {
  it('searches and names them from the server data folder, with the item names from the database', async () => {
    const api = await setup('/data/dbc');
    expect(((await api.searchEntities('extendedCost', 'mark')) as any).value).toEqual([{ id: 1, name: '2000 honor + 1 Mark of Honor' }]);
    expect(((await api.lookupNames('extendedCost', [1, 99])) as any).value).toEqual({ 1: '2000 honor + 1 Mark of Honor' });
  });

  it('finds nothing, without failing, when there is no server data folder', async () => {
    const api = await setup('');
    expect(await api.searchEntities('extendedCost', 'mark')).toEqual({ ok: true, value: [] });
    expect(await api.lookupNames('extendedCost', [1])).toEqual({ ok: true, value: {} });
  });

  it('gives an item\'s buy price in its template', async () => {
    const api = await setup('');
    expect(((await api.entityTemplate('item', 20559)) as any).value).toMatchObject({ name: 'Mark of Honor', buyPrice: 12050 });
  });
});
