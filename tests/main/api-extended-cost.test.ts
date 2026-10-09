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

async function setup(dbcDir: string, serverDataFiles: ServerDataFiles = files) {
  const db = forkDb();
  db.insert('item_template', { entry: '20559', name: 'Mark of Honor', displayid: '1', class: '12', subclass: '0', InventoryType: '0', BuyPrice: '12050' });
  const api = createApi({ store: openStore(':memory:', box), openWorldDb: async () => db, openDevDb: async () => { throw new Error('x'); },
    fs: { writeFile: async () => {}, ensureDir: async () => {}, listDir: async () => [] }, now: () => new Date(),
    session: createProjectSession(defaultProjectMeta('P', 'C:\out')), projects: {} as ProjectController, serverDataFiles });
  const rec: any = await api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p', dbcDir });
  await api.connect(rec.value.id);
  return api;
}

const broken: ServerDataFiles = { isDir: files.isDir, read: async (d, name) => (name === 'ItemExtendedCost.dbc' ? Uint8Array.from([1, 2, 3]) : null) };
const missing: ServerDataFiles = { isDir: files.isDir, read: async () => null };
const stock = (extendedCost: number) => ({ item: 20559, maxCount: 0, restockSecs: 0, extendedCost });

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

  it('says why when the server data folder has no readable ItemExtendedCost.dbc, so the author can type the id instead', async () => {
    for (const [folder, word] of [[broken, 'could not be read'], [missing, 'is not in']] as const) {
      const api: any = await setup('/data/dbc', folder);
      const out = await api.searchEntities('extendedCost', 'mark');
      expect(out.ok).toBe(false);
      expect(out.error.message).toContain(word);
    }
  });

  it("warns about a vendor's extended cost the DBC does not have", async () => {
    const api: any = await setup('/data/dbc');
    const { newNpc } = await import('../../src/core/entities/model');
    await api.putProjectEntities({ npcs: [{ ...newNpc(90001), name: 'Seller', displayId: 1, vendor: [stock(1), stock(99), stock(0)] }], objects: [], items: [] });
    const unknown = (await api.projectIssues()).value.filter((i: any) => i.code === 'VENDOR_UNKNOWN_COST');
    expect(unknown).toHaveLength(1);
    expect(unknown[0].message).toContain('99');
  });

  it('cannot tell without the DBC, so does not warn', async () => {
    const api: any = await setup('/data/dbc', missing);
    const { newNpc } = await import('../../src/core/entities/model');
    await api.putProjectEntities({ npcs: [{ ...newNpc(90001), name: 'Seller', displayId: 1, vendor: [stock(99)] }], objects: [], items: [] });
    expect((await api.projectIssues()).value.some((i: any) => i.code === 'VENDOR_UNKNOWN_COST')).toBe(false);
  });

  it('gives an item\'s buy price in its template', async () => {
    const api = await setup('');
    expect(((await api.entityTemplate('item', 20559)) as any).value).toMatchObject({ name: 'Mark of Honor', buyPrice: 12050 });
  });
});
