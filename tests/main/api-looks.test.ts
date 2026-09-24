import { describe, expect, it } from 'vitest';
import { createApi } from '../../src/main/api';
import { openStore } from '../../src/main/store/store';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta } from '../../src/main/project/project-file';
import type { ProjectController } from '../../src/main/project/controller';
import type { ServerDataFiles } from '../../src/main/server-data';
import { buildDbc, buildDbcWithStrings } from '../helpers/dbc';
import { forkDb } from '../helpers/fixtures';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };
/** Rows of numbers only, for `buildDbc`. */
const nums = (rows: (number | string)[][]): number[][] => rows as number[][];
const row = (n: number, set: Record<number, number | string>) => { const r: (number | string)[] = Array(n).fill(0); for (const [k, v] of Object.entries(set)) r[Number(k)] = v; return r; };
const DBC: Record<string, Uint8Array> = {
  'CreatureDisplayInfo.dbc': buildDbc(nums([row(16, { 0: 3167, 1: 49, 3: 23 })]), 16),
  'CreatureModelData.dbc': buildDbcWithStrings([row(28, { 0: 49, 2: 'Character\\Human\\Male\\HumanMale.mdx' })], 28),
  'CreatureDisplayInfoExtra.dbc': buildDbc(nums([row(21, { 0: 23, 1: 1, 2: 0, 11: 6080 })]), 21),
  'ChrRaces.dbc': buildDbcWithStrings([row(69, { 0: 1, 14: 'Human' })], 69),
  'GameObjectDisplayInfo.dbc': buildDbcWithStrings([row(19, { 0: 1, 1: 'World\\Chest02\\Chest02.mdx' })], 19),
  'FactionTemplate.dbc': buildDbc(nums([row(14, { 0: 11, 1: 72, 4: 2, 5: 12 })]), 14),
  'Faction.dbc': buildDbcWithStrings([row(57, { 0: 72, 23: 'Stormwind' })], 57),
};
const files: ServerDataFiles = { isDir: async (d) => d === '/data', read: async (d, name) => (d.replace(/\\/g, '/') === '/data/dbc' ? DBC[name] ?? null : null) };

async function apiWith(dbcDir: string) {
  const db = forkDb();
  db.insert('creature_template', { entry: '68', name: 'Stormwind City Guard' });
  db.insert('creature_template_model', { CreatureID: '68', Idx: '0', CreatureDisplayID: '3167', DisplayScale: '1', Probability: '1' });
  db.insert('gameobject_template', { entry: '2843', name: 'Battered Chest', displayId: '1' });
  const api = createApi({ store: openStore(':memory:', box), openWorldDb: async () => db, openDevDb: async () => { throw new Error('x'); },
    fs: { writeFile: async () => {}, ensureDir: async () => {}, listDir: async () => [] }, now: () => new Date(),
    session: createProjectSession(defaultProjectMeta('P', 'C:\\out')), projects: {} as ProjectController, serverDataFiles: files });
  const rec: any = await api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p', dbcDir });
  await api.connect(rec.value.id);
  return api;
}

describe('looks and factions through the API', () => {
  it('finds creature displays with the NPCs that use them', async () => {
    const api = await apiWith('/data/dbc');
    expect(((await api.searchEntities('creatureDisplay', 'human')) as any).value).toEqual([{ id: 3167, name: 'Human male · armoured', detail: 'used by Stormwind City Guard' }]);
    expect(((await api.lookupNames('creatureDisplay', [3167])) as any).value).toEqual({ 3167: 'Human male · armoured' });
  });
  it('finds object displays with the objects that use them', async () => {
    const api = await apiWith('/data/dbc');
    expect(((await api.searchEntities('objectDisplay', 'chest')) as any).value).toEqual([{ id: 1, name: 'Chest02', detail: 'used by Battered Chest' }]);
  });
  it('finds faction templates with who they like and hate', async () => {
    const api = await apiWith('/data/dbc');
    expect(((await api.searchEntities('factionTemplate', 'storm')) as any).value).toEqual([{ id: 11, name: 'Stormwind', detail: 'friendly to Alliance; hostile to Horde and monsters' }]);
    expect(((await api.lookupNames('factionTemplate', [11])) as any).value).toEqual({ 11: 'Stormwind' });
  });
  it('finds nothing without a server data folder', async () => {
    const api = await apiWith('');
    expect(((await api.searchEntities('creatureDisplay', 'human')) as any).value).toEqual([]);
    expect(((await api.lookupNames('factionTemplate', [11])) as any).value).toEqual({});
  });
});
