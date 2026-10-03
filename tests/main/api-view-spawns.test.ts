import { describe, expect, it } from 'vitest';
import { createApi } from '../../src/main/api';
import { openStore } from '../../src/main/store/store';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta } from '../../src/main/project/project-file';
import type { ProjectController } from '../../src/main/project/controller';
import { forkDb } from '../helpers/fixtures';

const secrets = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };
const AREA = { minX: -9000, maxX: -8800, minY: -200, maxY: -100 };

async function setup(seed: (db: ReturnType<typeof forkDb>) => void) {
  const db = forkDb();
  seed(db);
  const api = createApi({ store: openStore(':memory:', secrets), openWorldDb: async () => db, openDevDb: async () => { throw new Error('x'); },
    fs: { writeFile: async () => {}, ensureDir: async () => {}, listDir: async () => [] }, now: () => new Date(),
    session: createProjectSession(defaultProjectMeta('P', 'C:\\out')), projects: {} as ProjectController });
  const rec: any = await api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p' });
  await api.connect(rec.value.id);
  return api;
}

const guard = (db: ReturnType<typeof forkDb>) => {
  db.insert('creature_template', { entry: '68', name: 'Stormwind City Guard' });
  db.insert('creature_template_model', { CreatureID: '68', Idx: '1', CreatureDisplayID: '9999', DisplayScale: '2', Probability: '0' });
  db.insert('creature_template_model', { CreatureID: '68', Idx: '0', CreatureDisplayID: '3167', DisplayScale: '1.1', Probability: '1' });
  db.insert('creature', { guid: '1', id1: '68', map: '0', position_x: '-8900', position_y: '-150', position_z: '82', orientation: '3.14', wander_distance: '0', MovementType: '2', equipment_id: '1' });
  db.insert('creature_addon', { guid: '1', path_id: '10' });
  db.insert('waypoint_data', { id: '10', point: '2', position_x: '-8890', position_y: '-150', position_z: '82' });
  db.insert('waypoint_data', { id: '10', point: '1', position_x: '-8895', position_y: '-150', position_z: '82' });
  db.insert('creature_equip_template', { CreatureID: '68', ID: '1', ItemID1: '1899', ItemID2: '143', ItemID3: '0' });
};

describe('spawns for the 3D view', () => {
  it('gives a creature its first model, scale, path in point order and weapons', async () => {
    const api = await setup(guard);
    const out: any = await api.viewSpawns(0, AREA);
    expect(out.value.creatures).toEqual([{
      guid: 1, entry: 68, name: 'Stormwind City Guard', map: 0, x: -8900, y: -150, z: 82, orientation: 3.14,
      displayId: 3167, scale: 1.1, wander: 0,
      path: [{ x: -8895, y: -150, z: 82 }, { x: -8890, y: -150, z: 82 }],
      equipment: [1899, 143, 0], own: false,
    }]);
    expect(out.value.capped).toEqual({ creatures: false, objects: false });
  });

  it('gives a wanderer its radius, and a creature with no model row display 0', async () => {
    const api = await setup((db) => {
      db.insert('creature_template', { entry: '299', name: 'Young Wolf' });
      db.insert('creature', { guid: '2', id1: '299', map: '0', position_x: '-8950', position_y: '-120', position_z: '80', orientation: '0', wander_distance: '8', MovementType: '1', equipment_id: '0' });
    });
    const out: any = await api.viewSpawns(0, AREA);
    expect(out.value.creatures[0]).toMatchObject({ guid: 2, displayId: 0, scale: 1, wander: 8, path: null, equipment: [0, 0, 0] });
  });

  it('gives an object its rotation, display and size, and leaves out spawns outside the box or on another map', async () => {
    const api = await setup((db) => {
      db.insert('gameobject_template', { entry: '143981', type: '19', displayId: '1949', name: 'Mailbox', size: '1.5' });
      db.insert('gameobject', { guid: '7', id: '143981', map: '0', position_x: '-8920', position_y: '-160', position_z: '82', orientation: '1', rotation0: '0', rotation1: '0', rotation2: '0.5', rotation3: '0.8660254' });
      db.insert('gameobject', { guid: '8', id: '143981', map: '0', position_x: '-7000', position_y: '-160', position_z: '82' });
      db.insert('gameobject', { guid: '9', id: '143981', map: '1', position_x: '-8920', position_y: '-160', position_z: '82' });
    });
    const out: any = await api.viewSpawns(0, AREA);
    expect(out.value.objects).toEqual([{ guid: 7, entry: 143981, name: 'Mailbox', map: 0, x: -8920, y: -160, z: 82, rotation: [0, 0, 0.5, 0.8660254], displayId: 1949, scale: 1.5, own: false }]);
  });

  it('says when it capped a kind at 2000', async () => {
    const api = await setup((db) => {
      db.insert('gameobject_template', { entry: '1', type: '5', displayId: '1', name: 'Rock', size: '1' });
      for (let i = 0; i < 2001; i++) db.insert('gameobject', { guid: String(100 + i), id: '1', map: '0', position_x: '-8900', position_y: '-150', position_z: '82' });
    });
    const out: any = await api.viewSpawns(0, AREA);
    expect(out.value.objects).toHaveLength(2000);
    expect(out.value.capped).toEqual({ creatures: false, objects: true });
  });

  it('gives nothing, not an error, when the database cannot list spawns', async () => {
    const api = await setup(() => {});
    const out: any = await api.viewSpawns(0, AREA);
    expect(out.ok).toBe(true);
    expect(out.value.creatures).toEqual([]);
  });
});
