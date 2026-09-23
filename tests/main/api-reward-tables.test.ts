import { describe, it, expect } from 'vitest';
import { createApi } from '../../src/main/api';
import { openStore } from '../../src/main/store/store';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta } from '../../src/main/project/project-file';
import type { ProjectController } from '../../src/main/project/controller';
import type { ServerDataFiles } from '../../src/main/server-data';
import { FakeWorldDb } from '../helpers/fake-world-db';
import { questXpDbc } from '../helpers/dbc';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };

/** A server data folder at `/data` whose dbc folder holds QuestXP.dbc for levels 10 and 26. */
const dataFolder: ServerDataFiles = {
  isDir: async (d) => d === '/data',
  read: async (d, name) => (d.replace(/\\/g, '/') === '/data/dbc' && name === 'QuestXP.dbc' ? questXpDbc([10, 26]) : null),
};

async function apiWith(db: FakeWorldDb, dbcDir?: string) {
  const api = createApi({ store: openStore(':memory:', box), openWorldDb: async () => db, openDevDb: async () => { throw new Error('x'); },
    fs: { writeFile: async () => {}, ensureDir: async () => {}, listDir: async () => [] }, now: () => new Date(), session: createProjectSession(defaultProjectMeta('Untitled Project', 'C:\\out')), projects: {} as ProjectController,
    serverDataFiles: dataFolder });
  const rec: any = await api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p', dbcDir });
  const connected: any = await api.connect(rec.value.id);
  return Object.assign(api, { connected: connected.value });
}

describe('rewardTables', () => {
  it('reads xp and money rows for the level', async () => {
    const db = FakeWorldDb.fromFork(['quest_template', 'questxp_dbc', 'quest_money_reward']);
    db.insert('questxp_dbc', { ID: '10', Difficulty_1: '100', Difficulty_2: '200', Difficulty_10: '1000' });
    db.insert('quest_money_reward', { Level: '10', Money0: '0', Money1: '50', Money9: '900' });
    const r: any = await (await apiWith(db)).rewardTables(10);
    expect(r.ok).toBe(true);
    expect(r.value.xp).toHaveLength(10);
    expect(r.value.xp[0]).toBe(100); expect(r.value.xp[1]).toBe(200); expect(r.value.xp[9]).toBe(1000);
    expect(r.value.money[1]).toBe(50); expect(r.value.money[9]).toBe(900);
  });
  it('returns nulls for a missing row, a missing table or an out-of-range level', async () => {
    const db = FakeWorldDb.fromFork(['quest_template']);
    const api = await apiWith(db);
    for (const level of [10, 0, 81, -1]) {
      const r: any = await api.rewardTables(level);
      expect(r.value.xp).toEqual(Array(10).fill(null));
      expect(r.value.money).toEqual(Array(10).fill(null));
    }
  });
  it('takes the XP from the server QuestXP.dbc when questxp_dbc has no row', async () => {
    const api = await apiWith(FakeWorldDb.fromFork(['quest_template', 'questxp_dbc']), '/data');
    expect(api.connected.serverData).toEqual({ dir: '/data', loaded: ['QuestXP.dbc'], problems: [] });
    const r: any = await api.rewardTables(26);
    expect(r.value.xp).toEqual([0, 2600, 5200, 7800, 10400, 13000, 15600, 18200, 20800, 23400]);
  });
  it('lets a questxp_dbc row override the file, as the server does', async () => {
    const db = FakeWorldDb.fromFork(['quest_template', 'questxp_dbc']);
    db.insert('questxp_dbc', { ID: '10', Difficulty_1: '7', Difficulty_2: '8' });
    const r: any = await (await apiWith(db, '/data')).rewardTables(10);
    expect(r.value.xp.slice(0, 2)).toEqual([7, 8]);
  });
  it('still connects when the folder cannot be read, reporting why', async () => {
    const api = await apiWith(FakeWorldDb.fromFork(['quest_template']), '/elsewhere');
    expect(api.connected.serverData.problems).toEqual(['The server data folder /elsewhere does not exist.']);
    expect(((await api.rewardTables(10)) as any).value.xp).toEqual(Array(10).fill(null));
  });
  it('reports no server data for a profile without a folder', async () => {
    expect((await apiWith(FakeWorldDb.fromFork(['quest_template']))).connected.serverData).toBeNull();
  });
});
