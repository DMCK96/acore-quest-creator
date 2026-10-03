import { describe, expect, it } from 'vitest';
import { createApi } from '../../src/main/api';
import { openStore } from '../../src/main/store/store';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta } from '../../src/main/project/project-file';
import type { ProjectController } from '../../src/main/project/controller';
import { forkDb } from '../helpers/fixtures';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };

async function setup(seed: (db: ReturnType<typeof forkDb>) => void = () => {}) {
  const db = forkDb();
  seed(db);
  const written = new Map<string, string>();
  const session = createProjectSession(defaultProjectMeta('P', 'C:\\out'));
  const api = createApi({ store: openStore(':memory:', box), openWorldDb: async () => db, openDevDb: async () => { throw new Error('x'); },
    fs: { writeFile: async (p: string, t: string) => { written.set(p, t); }, ensureDir: async () => {}, listDir: async () => [...written.keys()].map((p) => p.split('\\').at(-1)!) },
    now: () => new Date('2026-10-03T12:00:00Z'), session, projects: {} as ProjectController });
  const rec: any = await api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p' });
  await api.connect(rec.value.id);
  return { api, db, session, written };
}

const world = (db: ReturnType<typeof forkDb>) => {
  db.insert('creature_template', { entry: '1423', name: 'Stormwind Guard' });
  db.insert('creature', { guid: '80330', id1: '1423', map: '0', position_x: '-9481.31', position_y: '74.42', position_z: '56.55', orientation: '1.5' });
  db.insert('creature', { guid: '80331', id1: '1423', map: '0', position_x: '-9480', position_y: '70', position_z: '56', orientation: '0' });
  db.insert('creature', { guid: '80332', id1: '1423', map: '0', position_x: '-9470', position_y: '70', position_z: '56', orientation: '0' });
  db.insert('gameobject_template', { entry: '143981', type: '19', displayId: '1949', name: 'Mailbox', size: '1' });
  db.insert('gameobject', { guid: '5', id: '143981', map: '0', position_x: '-9460', position_y: '40', position_z: '57', orientation: '0', rotation0: '0', rotation1: '0', rotation2: '0', rotation3: '1' });
  db.insert('creature_addon', { guid: '80330', path_id: '801' });
  db.insert('creature_template_addon', { entry: '1423', path_id: '802' });
  db.insert('waypoint_data', { id: '801', point: '2', position_x: '20', position_y: '0', position_z: '1', delay: '3000' });
  db.insert('waypoint_data', { id: '801', point: '1', position_x: '10', position_y: '0', position_z: '1', delay: '0' });
  db.insert('waypoint_data', { id: '802', point: '1', position_x: '1', position_y: '1', position_z: '1' });
  db.insert('waypoint_data', { id: '802', point: '2', position_x: '2', position_y: '2', position_z: '2' });
};
const to = (x: number) => ({ x, y: 74.42, z: 56.55, orientation: 2, rotation: null });

describe('the world layer through the API', () => {
  it('reads a spawn\'s original from the database at its first move only', async () => {
    const { api, db, session } = await setup(world);
    await api.worldMoveSpawn('creature', 80330, to(-9470));
    db.update('creature', { guid: '80330' }, { position_x: '0', position_y: '0', position_z: '0', orientation: '0' });
    const out: any = await api.worldMoveSpawn('creature', 80330, to(-9460));
    expect(out.value.spawns).toEqual([{ kind: 'creature', guid: 80330, entry: 1423, name: 'Stormwind Guard', map: 0,
      original: { x: -9481.31, y: 74.42, z: 56.55, orientation: 1.5, rotation: null }, current: to(-9460) }]);
    expect(session.world.get()).toEqual(out.value);
    expect(session.dirty()).toBe(true);
  });

  it('reads an object\'s rotation', async () => {
    const { api } = await setup(world);
    const out: any = await api.worldMoveSpawn('gameobject', 5, { x: -9461, y: 40, z: 57, orientation: 0, rotation: [0, 0, 0, 1] });
    expect(out.value.spawns[0].original.rotation).toEqual([0, 0, 0, 1]);
  });

  it('refuses a spawn that is not in the database', async () => {
    const { api } = await setup(world);
    const out: any = await api.worldMoveSpawn('creature', 4242, to(1));
    expect(out.ok).toBe(false);
    expect(out.error.message).toBe('Spawn 4242 is no longer in the database.');
  });

  it('gives a route in point order with its other columns, and counts its walkers', async () => {
    const { api } = await setup(world);
    const own: any = await api.worldRoute(801);
    expect(own.value.walkers).toBe(1);
    expect(own.value.points.map((p: any) => [p.x, p.rest.delay])).toEqual([[10, '0'], [20, '3000']]);
    expect(own.value.points[0].rest).not.toHaveProperty('id');
    expect(own.value.points[0].rest).not.toHaveProperty('point');
    const shared: any = await api.worldRoute(802);
    expect(shared.value.walkers).toBe(3);
  });

  it('counts no template walkers when the table is missing', async () => {
    const { api, db } = await setup(world);
    db.forbidTable('creature_template_addon');
    const out: any = await api.worldRoute(801);
    expect(out.value.walkers).toBe(1);
  });

  it('sets a route, keeping the first original, and gives back the edited points', async () => {
    const { api } = await setup(world);
    const first: any = await api.worldRoute(801);
    const points = [first.value.points[0], { x: 15, y: 0, z: 1, rest: {} }, first.value.points[1]];
    const out: any = await api.worldSetRoute(801, points);
    expect(out.value.routes[0]).toMatchObject({ pathId: 801, walkers: 1, current: points });
    expect(((await api.worldRoute(801)) as any).value.points).toEqual(points);
  });

  it('reverts a spawn and a route', async () => {
    const { api } = await setup(world);
    await api.worldMoveSpawn('creature', 80330, to(1));
    await api.worldSetRoute(801, [{ x: 1, y: 1, z: 1, rest: {} }, { x: 2, y: 2, z: 2, rest: {} }]);
    await api.worldRevert({ kind: 'spawn', spawnKind: 'creature', guid: 80330 });
    const out: any = await api.worldRevert({ kind: 'route', pathId: 801 });
    expect(out.value).toEqual({ spawns: [], routes: [] });
  });

  it('says which changes the database has moved away from since', async () => {
    const { api, db } = await setup(world);
    await api.worldMoveSpawn('creature', 80330, to(1));
    await api.worldMoveSpawn('gameobject', 5, { x: 1, y: 40, z: 57, orientation: 0, rotation: [0, 0, 0, 1] });
    db.update('creature', { guid: '80330' }, { position_x: '0', position_y: '0', position_z: '0', orientation: '0' });
    const out: any = await api.worldChanges();
    expect(out.value.map((c: any) => [c.type, c.guid, c.drifted])).toEqual([['spawn', 80330, true], ['spawn', 5, false]]);
  });

  it('exports the world patch and its revert, numbered per day', async () => {
    const { api, written } = await setup(world);
    expect(((await api.exportWorld()) as any).error.message).toBe('There are no world changes to export.');
    await api.worldMoveSpawn('creature', 80330, to(-9470));
    const out: any = await api.exportWorld();
    expect(out.value.applyPath).toMatch(/2026_10_03_00_world\.sql$/);
    expect(out.value.revertPath).toMatch(/2026_10_03_00_world_revert\.sql$/);
    expect(written.get(out.value.applyPath)).toMatch(/UPDATE `creature` SET .*`position_x` = -9470.*WHERE `guid` = 80330/s);
    expect(written.get(out.value.revertPath)).toMatch(/`position_x` = -9481.31/);
    expect(written.get(out.value.applyPath)).toContain('-- World changes');
    const again: any = await api.exportWorld();
    expect(again.value.applyPath).toMatch(/2026_10_03_01_world\.sql$/);
  });

  it('exports a point added in 3D with every column the database has, at its default', async () => {
    const { api, written } = await setup(world);
    const first: any = await api.worldRoute(801);
    await api.worldSetRoute(801, [...first.value.points, { x: 30, y: 0, z: 1, rest: {} }]);
    const out: any = await api.exportWorld();
    expect(out.ok).toBe(true);
    const sql = written.get(out.value.applyPath)!;
    expect(sql).toMatch(/INSERT INTO `waypoint_data` .*`velocity`.*VALUES \(801, 3, 30, 0, 1,/);
  });

  it('keeps both of two edits to different spawns that overlap', async () => {
    const { api, session } = await setup(world);
    await Promise.all([
      api.worldMoveSpawn('creature', 80330, to(-9470)),
      api.worldMoveSpawn('gameobject', 5, { x: -9461, y: 40, z: 57, orientation: 1, rotation: [0, 0, 0.5, 0.8660254] }),
    ]);
    expect(session.world.get().spawns.map((s) => s.guid).sort()).toEqual([5, 80330]);
  });
});
