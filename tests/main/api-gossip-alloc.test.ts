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

async function setup(seed: (db: ReturnType<typeof forkDb>) => void) {
  const db = forkDb();
  seed(db);
  const api = createApi({ store: openStore(':memory:', box), openWorldDb: async () => db, openDevDb: async () => { throw new Error('x'); },
    fs: { writeFile: async () => {}, ensureDir: async () => {}, listDir: async () => [] }, now: () => new Date(),
    session: createProjectSession(defaultProjectMeta('P', 'C:/out')), projects: {} as ProjectController });
  const rec: any = await api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p' });
  await api.connect(rec.value.id);
  return { api, db };
}

const holder = (menuId: number, textId: number) => ({
  ...newNpc(90001), name: 'T', displayId: 1,
  gossipMenu: { menus: [{ menuId, textId, locked: false, greeting: [{ text: 'Hi', textFemale: '', probability: 1 }], options: [] }] },
});

describe('gossip ids', () => {
  const seed = (db: ReturnType<typeof forkDb>) => {
    db.insert('gossip_menu', { MenuID: '932534', TextID: '9780011' });
    db.insert('gossip_menu_option', { MenuID: '932540', OptionID: '0', OptionText: 'x' });
    db.insert('creature_template', { entry: '555', name: 'Other', gossip_menu_id: '932550' });
    db.insert('gameobject_template', { entry: '100', type: '2', Data3: '932560' });
    db.insert('gameobject_template', { entry: '101', type: '5', Data3: '999999999' });
    db.insert('npc_text', { ID: '9780012', text0_0: 'a', Probability0: '1' });
    db.insert('npc_text', { ID: '16777215', text0_0: 'a', Probability0: '1' });
  };

  it('are allocated above the database and the project, ignoring the text id that sits at the top of the range and data that is not a menu', async () => {
    const { api } = await setup(seed);
    expect(((await api.allocateIds('gossipMenu', 2)) as any).value).toEqual([932561, 932562]);
    expect(((await api.allocateIds('gossipText', 2)) as any).value).toEqual([9780013, 9780014]);
    await api.putProjectEntities({ npcs: [holder(932570, 9780020)], objects: [], items: [] });
    expect(((await api.allocateIds('gossipMenu', 1)) as any).value).toEqual([932571]);
    expect(((await api.allocateIds('gossipText', 1)) as any).value).toEqual([9780021]);
  });

  it('count a menu or text an NPC points at though its rows are missing', async () => {
    const { api } = await setup((db) => {
      db.insert('creature_template', { entry: '555', name: 'Other', gossip_menu_id: '932600' });
      db.insert('gossip_menu', { MenuID: '932601', TextID: '9780030' });
    });
    expect(((await api.allocateIds('gossipMenu', 1)) as any).value).toEqual([932602]);
    expect(((await api.allocateIds('gossipText', 1)) as any).value).toEqual([9780031]);
  });

  it('are accepted over IPC', () => {
    expect(parseRequest('allocateIds', ['gossipMenu', 1]).ok).toBe(true);
    expect(parseRequest('allocateIds', ['gossipText', 1]).ok).toBe(true);
    expect(parseRequest('allocateIds', ['gossip', 1]).ok).toBe(false);
  });
});
