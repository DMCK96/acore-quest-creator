import { describe, it, expect } from 'vitest';
import { createApi } from '../../src/main/api';
import { openStore } from '../../src/main/store/store';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta } from '../../src/main/project/project-file';
import { FakeWorldDb } from '../helpers/fake-world-db';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };
async function apiWith(db: FakeWorldDb) {
  const api = createApi({ store: openStore(':memory:', box), openWorldDb: async () => db, openDevDb: async () => { throw new Error('x'); },
    fs: { writeFile: async () => {}, ensureDir: async () => {}, listDir: async () => [] }, now: () => new Date(), session: createProjectSession(defaultProjectMeta('Untitled Project', 'C:\\out')) });
  const rec: any = await api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p' });
  await api.connect(rec.value.id);
  return api;
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
});
