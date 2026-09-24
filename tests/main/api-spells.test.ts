import { describe, expect, it } from 'vitest';
import { createApi } from '../../src/main/api';
import { openStore } from '../../src/main/store/store';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta } from '../../src/main/project/project-file';
import type { ProjectController } from '../../src/main/project/controller';
import type { ServerDataFiles } from '../../src/main/server-data';
import { buildDbc, buildDbcWithStrings, f32 } from '../helpers/dbc';
import { forkDb } from '../helpers/fixtures';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };
const spell = (id: number, name: string, rank = '') => { const r: (number | string)[] = Array(234).fill(0); r[0] = id; r[136] = name; r[153] = rank; r[28] = 1; r[46] = 4; r[225] = 16; r[86] = 6; return r; };
const DBC: Record<string, Uint8Array> = {
  'Spell.dbc': buildDbcWithStrings([spell(116, 'Frostbolt', 'Rank 1'), spell(122, 'Frost Nova', 'Rank 1')], 234),
  'SpellCastTimes.dbc': buildDbc([[1, 0, 0, 0]]),
  'SpellRange.dbc': buildDbc([[4, 0, 0, f32(30), f32(30), 0, ...Array(34).fill(0)]], 40),
};
let reads = 0;
const files = (broken = false): ServerDataFiles => ({
  isDir: async (d) => d === '/data',
  read: async (d, name) => {
    if (d.replace(/\\/g, '/') !== '/data/dbc') return null;
    if (name === 'Spell.dbc') reads += 1;
    if (broken && name === 'Spell.dbc') return new Uint8Array([1, 2, 3]);
    return DBC[name] ?? null;
  },
});

async function apiWith(dbcDir: string, broken = false) {
  const db = forkDb();
  const api = createApi({ store: openStore(':memory:', box), openWorldDb: async () => db, openDevDb: async () => { throw new Error('x'); },
    fs: { writeFile: async () => {}, ensureDir: async () => {}, listDir: async () => [] }, now: () => new Date(),
    session: createProjectSession(defaultProjectMeta('P', 'C:\\out')), projects: {} as ProjectController, serverDataFiles: files(broken) });
  const rec: any = await api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p', dbcDir });
  await api.connect(rec.value.id);
  return api;
}

describe('spells through the API', () => {
  it('searches and names spells from the server data folder, loading them once and only when asked', async () => {
    reads = 0;
    const api = await apiWith('/data');
    expect(reads).toBe(0);
    const hits: any = await api.searchEntities('spell', 'frost');
    expect(hits.value).toEqual([
      { id: 116, name: 'Frostbolt (Rank 1)', detail: 'Rank 1 · instant · 30 yd · Frost · harmful' },
      { id: 122, name: 'Frost Nova (Rank 1)', detail: 'Rank 1 · instant · 30 yd · Frost · harmful' },
    ]);
    const names: any = await api.lookupNames('spell', [116, 999]);
    expect(names.value).toEqual({ 116: 'Frostbolt (Rank 1)' });
    const facts: any = await api.spellFacts([116]);
    expect(facts.value).toMatchObject({ available: true, spells: { 116: { name: 'Frostbolt', kind: 'harmful' } } });
    expect(reads).toBe(1);
  });

  it('explains why there are no spell names', { timeout: 15000 }, async () => {
    const none: any = await (await apiWith('')).spellFacts([116]);
    expect(none.value).toEqual({ available: false, reason: 'Spell names need the server data folder.', spells: {} });
    const broken: any = await (await apiWith('/data', true)).spellFacts([116]);
    expect(broken.value.available).toBe(false);
    expect(broken.value.reason).toMatch(/^Spell\.dbc could not be read: /);
    expect(((await (await apiWith('')).searchEntities('spell', 'frost')) as any).value).toEqual([]);
  });
});
