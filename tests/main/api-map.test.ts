import { describe, expect, it } from 'vitest';
import { createApi } from '../../src/main/api';
import { openStore } from '../../src/main/store/store';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta } from '../../src/main/project/project-file';
import type { ProjectController } from '../../src/main/project/controller';
import type { ServerDataFiles } from '../../src/main/server-data';
import { buildMapFile } from '../helpers/map-file';
import { buildNavTile } from '../helpers/nav-tile';
import { forkDb } from '../helpers/fixtures';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };
const sq = (z: number): [number, number, number][] => [[-9000, -200, z], [-8850, -200, z], [-8850, -100, z], [-9000, -100, z]];
const files: ServerDataFiles = {
  isDir: async (d) => d === '/data',
  read: async (d, name) => {
    const dir = d.replace(/\\/g, '/');
    if (dir === '/data/maps' && name === '0004832.map') return buildMapFile({ kind: 'flat', gridHeight: 82.1 });
    if (dir === '/data/mmaps' && name === '0004832.mmtile') return buildNavTile([{ verts: sq(82.18) }, { verts: sq(98.12) }]);
    return null;
  },
};

async function setup(dbcDir = '/data') {
  const db = forkDb();
  db.insert('creature_template', { entry: '197', name: 'Marshal McBride' });
  db.insert('creature', { guid: '79970', id1: '197', map: '0', position_x: '-8902.59', position_y: '-162.606', position_z: '82.0223' });
  db.insert('creature', { guid: '79971', id1: '197', map: '1', position_x: '1', position_y: '1', position_z: '1' });
  const api = createApi({ store: openStore(':memory:', box), openWorldDb: async () => db, openDevDb: async () => { throw new Error('x'); },
    fs: { writeFile: async () => {}, ensureDir: async () => {}, listDir: async () => [] }, now: () => new Date(),
    session: createProjectSession(defaultProjectMeta('P', 'C:\\out')), projects: {} as ProjectController, serverDataFiles: files });
  const rec: any = await api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p', dbcDir });
  await api.connect(rec.value.id);
  return api;
}

describe('map API', () => {
  it('gives the floors and the ground at a point', async () => {
    const out: any = await (await setup()).mapFloors(0, -8902.59, -162.606);
    expect(out.value).toEqual({ floors: [82.18, 98.12], ground: 82.1 });
  });
  it('explains why there are no floors', async () => {
    const none: any = await (await setup('')).mapFloors(0, -8902.59, -162.606);
    expect(none.value.reason).toMatch(/server data folder/);
    const elsewhere: any = await (await setup()).mapFloors(1, 5000, 5000);
    expect(elsewhere.value).toEqual({ floors: [], ground: null });
  });
  it('lists spawns in a box with their names, and says when it capped them', async () => {
    const out: any = await (await setup()).mapSpawns(0, { minX: -9000, maxX: -8800, minY: -200, maxY: -100 });
    expect(out.value).toEqual({ capped: false, dots: [{ kind: 'creature', guid: 79970, entry: 197, name: 'Marshal McBride', map: 0, x: -8902.59, y: -162.606, z: 82.0223 }] });
  });
  it('finds where an NPC stands, for the search box', async () => {
    const out: any = await (await setup()).entitySpawns('creature', 197);
    expect(out.value.map((d: any) => [d.guid, d.map])).toEqual([[79970, 0], [79971, 1]]);
  });
  it('gives the spawns of the quest giver as read-only references', async () => {
    const api = await setup();
    const opened: any = await api.newQuest();
    const aggregate = opened.value.aggregate;
    aggregate.values.creature_queststarter = [{ id: 197 }];
    await api.updateQuest(aggregate);
    const out: any = await api.questMapRefs(aggregate.questId);
    expect(out.value.map((r: any) => [r.role, r.guid])).toEqual([['giver', 79970], ['giver', 79971]]);
  });
  it('lists the continents even without a server data folder', async () => {
    const out: any = await (await setup('')).mapList();
    expect(out.value.map((m: any) => [m.id, m.name])).toEqual([[0, 'Eastern Kingdoms'], [1, 'Kalimdor'], [530, 'Outland'], [571, 'Northrend']]);
  });
});
