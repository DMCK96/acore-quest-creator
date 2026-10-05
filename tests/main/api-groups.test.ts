import { describe, expect, it } from 'vitest';
import { createApi } from '../../src/main/api';
import { openStore } from '../../src/main/store/store';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta } from '../../src/main/project/project-file';
import type { ProjectController } from '../../src/main/project/controller';
import { forkDb } from '../helpers/fixtures';
import { newNpc, newSpawn } from '../../src/core/entities/model';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };

async function setup() {
  const db = forkDb();
  db.insert('creature_template', { entry: '32491', name: 'Time-Lost Proto-Drake' });
  db.insert('creature_template', { entry: '32630', name: 'Vyragosa' });
  for (const [guid, id, x] of [['39203', '32491', '10'], ['39207', '32630', '10'], ['39204', '32491', '50'], ['39208', '32630', '50']]) {
    db.insert('creature', { guid, id1: id, map: '571', position_x: x, position_y: '0', position_z: '0', orientation: '0', spawntimesecs: '2700' });
  }
  db.insert('creature', { guid: '80330', id1: '32491', map: '0', position_x: '0', position_y: '0', position_z: '0', orientation: '0' });
  db.insert('pool_template', { entry: '32491', max_limit: '1', description: 'Time-Lost Proto Drake / Vyragosa' });
  db.insert('pool_template', { entry: '32492', max_limit: '1', description: 'Path 1' });
  db.insert('pool_template', { entry: '32493', max_limit: '1', description: 'Path 2' });
  db.insert('pool_creature', { guid: '39203', pool_entry: '32492', chance: '10', description: 'Path 1' });
  db.insert('pool_creature', { guid: '39207', pool_entry: '32492', chance: '0', description: 'Path 1' });
  db.insert('pool_creature', { guid: '39204', pool_entry: '32493', chance: '10', description: 'Path 2' });
  db.insert('pool_creature', { guid: '39208', pool_entry: '32493', chance: '0', description: 'Path 2' });
  db.insert('pool_pool', { pool_id: '32492', mother_pool: '32491', chance: '0', description: 'Path 1' });
  db.insert('pool_pool', { pool_id: '32493', mother_pool: '32491', chance: '0', description: 'Path 2' });
  db.insert('gameobject_template', { entry: '143981', type: '19', displayId: '1949', name: 'Mailbox', size: '1' });
  db.insert('gameobject', { guid: '5', id: '143981', map: '571', position_x: '0', position_y: '0', position_z: '0', orientation: '0', rotation0: '0', rotation1: '0', rotation2: '0', rotation3: '1' });
  const session = createProjectSession(defaultProjectMeta('P', 'C:\\out'));
  const written = new Map<string, string>();
  const api = createApi({ store: openStore(':memory:', box), openWorldDb: async () => db, openDevDb: async () => { throw new Error('x'); },
    fs: { writeFile: async (p: string, t: string) => { written.set(p, t); }, ensureDir: async () => {}, listDir: async () => [...written.keys()].map((p) => p.split('\\').at(-1)!) },
    now: () => new Date('2026-10-05T12:00:00Z'), session, projects: {} as ProjectController });
  const rec: any = await api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p' });
  await api.connect(rec.value.id);
  return { api, db, session, written };
}

describe('spawn groups through the API', () => {
  it('reads an existing pool as a group, with its original rows', async () => {
    const { api } = await setup();
    const out: any = await api.worldGroup(32492);
    expect(out.value).toMatchObject({ id: 32492, name: 'Path 1', map: 571, maxActive: 1,
      members: [{ type: 'spawn', kind: 'npc', guid: 39203, entry: 32491, chance: 10 }, { type: 'spawn', kind: 'npc', guid: 39207, entry: 32630, chance: 0 }],
      origin: { kind: 'existing' } });
    const mother: any = await api.worldGroup(32491);
    expect(mother.value.members).toEqual([{ type: 'group', id: 32492, chance: 0 }, { type: 'group', id: 32493, chance: 0 }]);
    expect(mother.value.map).toBe(571);
  });

  it('describes a group for the view: members by name with where they stand; a group member at its centre', async () => {
    const { api } = await setup();
    const out: any = await api.worldGroupView(32491);
    expect(out.value).toEqual({ id: 32491, name: 'Time-Lost Proto Drake / Vyragosa', map: 571, maxActive: 1, members: [
      { key: 'group:32492', type: 'group', name: 'Path 1', chance: 0, at: { x: 10, y: 0, z: 0 } },
      { key: 'group:32493', type: 'group', name: 'Path 2', chance: 0, at: { x: 50, y: 0, z: 0 } },
    ] });
  });

  it('lists the groups on a map and gives a free id', async () => {
    const { api } = await setup();
    expect(((await api.worldGroupsOnMap(571)) as any).value.map((g: any) => g.name)).toEqual(['Path 1', 'Path 2', 'Time-Lost Proto Drake / Vyragosa']);
    expect(((await api.worldNewGroupId()) as any).value).toBe(32494);
  });

  it('reads the pool tables once per connection for the groups on a map, again after an export, with the same list', async () => {
    const { api, db } = await setup();
    const select = db.selectRows.bind(db);
    let wholeReads = 0;
    db.selectRows = async (table: string, where: any) => {
      if (table === 'pool_creature' && Object.keys(where).length === 0) wholeReads += 1;
      return select(table, where);
    };
    const first: any = await api.worldGroupsOnMap(571);
    const again: any = await api.worldGroupsOnMap(571);
    expect(again.value).toEqual(first.value);
    expect(((await api.worldGroupsOnMap(0)) as any).value).toEqual([]);
    expect(wholeReads).toBe(1);
    await api.worldDeleteGroup(32493);
    await api.exportProject();
    expect(((await api.worldGroupsOnMap(571)) as any).value.map((g: any) => g.name)).toEqual(['Path 1', 'Time-Lost Proto Drake / Vyragosa']);
    expect(wholeReads).toBe(2);
  });

  it('deleting a group inside another takes it out of that group in the same step, so no member is left dangling', async () => {
    const { api } = await setup();
    const out: any = await api.worldDeleteGroup(32493);
    expect(out.ok).toBe(true);
    const mother = out.value.groups.find((g: any) => g.id === 32491);
    expect(mother.members).toEqual([{ type: 'group', id: 32492, chance: 0 }]);
    expect(out.value.groups.find((g: any) => g.id === 32493).removed).toBe(true);
    expect(((await api.worldCheckGroup(mother, [])) as any).value).toEqual([]);
    expect(((await api.exportProject()) as any).ok).toBe(true);
    // One step: a single undo puts both back
    await api.historyUndo();
    expect(((await api.worldLayer()) as any).value.groups ?? []).toEqual([]);
  });

  it('names a member group deleted here when its holder is checked', async () => {
    const { api, session } = await setup();
    const mother: any = ((await api.worldGroup(32491)) as any).value;
    const child: any = ((await api.worldGroup(32493)) as any).value;
    session.world.put({ spawns: [], routes: [], added: [], groups: [{ ...child, removed: true }] });
    expect(((await api.worldCheckGroup(mother, [])) as any).value).toContain('Group 32493 is not there any more.');
  });

  it('saves a valid new group as one step, and refuses one the server would not load, with why', async () => {
    const { api } = await setup();
    const group = { id: 32494, name: 'Two drakes', map: 571, maxActive: 1, origin: { kind: 'new' },
      members: [{ type: 'spawn', kind: 'npc', guid: 39203, entry: 32491, chance: 0 }, { type: 'spawn', kind: 'npc', guid: 80330, entry: 32491, chance: 0 }] };
    expect(((await api.worldCheckGroup(group as any, [])) as any).value).toEqual(['Spawn 39203 is already in group 32492.', 'Spawn 80330 is on another map.']);
    const refused: any = await api.worldSetGroup(group as any, []);
    expect(refused.ok).toBe(false);
    expect(refused.error.issues.map((i: any) => i.message)).toContain('Spawn 80330 is on another map.');
    const fine = { ...group, members: [group.members[0]] };
    const saved: any = await api.worldSetGroup(fine as any, [{ kind: 'npc', guid: 39203 }]);
    expect(saved.ok).toBe(true);
    expect(saved.value.groups.map((g: any) => [g.id, g.members.length])).toEqual([[32492, 1], [32494, 1]]);
  });

  it('refuses a mailbox: the server pools only lootable and usable objects', async () => {
    const { api } = await setup();
    const group = { id: 32494, name: 'Mail', map: 571, maxActive: 1, origin: { kind: 'new' }, members: [{ type: 'spawn', kind: 'object', guid: 5, entry: 143981, chance: 0 }] };
    expect(((await api.worldCheckGroup(group as any, [])) as any).value).toEqual(['Spawn 5 cannot be pooled: only chests (herbs and veins are chests), usable objects and fishing schools can be.']);
  });

  it('deletes, lists, reverts and exports group changes', async () => {
    const { api, written, db } = await setup();
    await api.worldDeleteGroup(32493);
    const changes: any = await api.worldChanges();
    expect(changes.value).toContainEqual(expect.objectContaining({ type: 'group', id: 32493, removed: true, drifted: false }));
    db.update('pool_template', { entry: '32493' }, { max_limit: '2' });
    expect(((await api.worldChanges()) as any).value.find((c: any) => c.type === 'group' && c.id === 32493).drifted).toBe(true);
    const out: any = await api.exportProject();
    expect(out.error).toBeUndefined();
    expect([...written.values()].find((t) => t.includes('DELETE FROM `pool_template`'))).toBeTruthy();
    const back: any = await api.worldRevert({ kind: 'group', id: 32493 });
    // The group that held it is a change of its own, reverted on its own
    expect(back.value.groups.map((g: any) => g.id)).toEqual([32491]);
    const both: any = await api.worldRevert({ kind: 'group', id: 32491 });
    expect(both.value.groups ?? []).toEqual([]);
  });

  it('gives each spawn of the 3D view its group, or null', async () => {
    const { api } = await setup();
    const out: any = await api.viewSpawns(571, { minX: -100, maxX: 100, minY: -100, maxY: 100 });
    expect(out.value.creatures.map((c: any) => [c.guid, c.group])).toEqual([[39203, 32492], [39204, 32493], [39207, 32492], [39208, 32493]]);
    expect(out.value.objects.map((o: any) => [o.guid, o.group])).toEqual([[5, null]]);
  });

  it('refuses to export a layer group the server would not load, naming the group', async () => {
    const { api, db } = await setup();
    const group: any = ((await api.worldGroup(32492)) as any).value;
    await api.worldSetGroup({ ...group, maxActive: 1 }, []);
    db.update('creature', { guid: '39207' }, { map: '0' });
    const out: any = await api.exportProject();
    expect(out.ok).toBe(false);
    expect(out.error.message).toBe('Fix the spawn groups first.');
    expect(out.error.issues.map((i: any) => i.message)).toEqual(['Path 1: Spawn 39207 is on another map.']);
  });

  it('a removed project spawn leaves its groups', async () => {
    const { api } = await setup();
    await api.worldSetGroup({ id: 32494, name: 'Solo', map: 0, maxActive: 1, origin: { kind: 'new' }, members: [{ type: 'spawn', kind: 'npc', guid: 80330, entry: 32491, chance: 0 }] } as any, []);
    const out: any = await api.worldDropMember('npc', 80330);
    expect(out.value.groups ?? []).toEqual([]);
  });

  it('a project spawn removed outside the 3D menu (its NPC deleted, or the spawn taken off it) leaves its group in the same step', async () => {
    const { api } = await setup();
    const hela = { ...newNpc(12000001), name: 'Hela', spawns: [{ ...newSpawn(900), map: 571 }] };
    const odin = { ...newNpc(12000002), name: 'Odin', spawns: [{ ...newSpawn(901), map: 571 }, { ...newSpawn(902), map: 571 }] };
    await api.putProjectEntities({ npcs: [hela, odin], objects: [], items: [] });
    const spawn = (guid: number, entry: number) => ({ type: 'spawn', kind: 'npc', guid, entry, chance: 0 });
    const saved: any = await api.worldSetGroup({ id: 32494, name: 'Gods', map: 571, maxActive: 1, origin: { kind: 'new' },
      members: [spawn(900, 12000001), spawn(901, 12000002), spawn(902, 12000002)] } as any, []);
    expect(saved.ok).toBe(true);
    await api.deleteEntity('npc', 12000001);
    const members = async () => (((await api.worldLayer()) as any).value.groups ?? []).flatMap((g: any) => g.members.map((m: any) => m.guid));
    expect(await members()).toEqual([901, 902]);
    await api.putProjectEntities({ npcs: [{ ...odin, spawns: [odin.spawns[0]!] }], objects: [], items: [] });
    expect(await members()).toEqual([901]);
    // Each was one step: one undo brings the spawn back into the group with it
    await api.historyUndo();
    expect(await members()).toEqual([901, 902]);
    expect(((await api.projectEntities()) as any).value.npcs[0].spawns).toHaveLength(2);
  });
  it('takes a group origin from the layer copy or the database, never from what the renderer sends', async () => {
    const { api } = await setup();
    const group: any = ((await api.worldGroup(32492)) as any).value;
    const forged = { kind: 'existing', original: { template: { entry: '32492', max_limit: '9', description: 'forged' }, members: [], event: null } };
    const saved: any = await api.worldSetGroup({ ...group, name: 'Path one', origin: forged, removed: true }, []);
    expect(saved.ok).toBe(true);
    const copy = saved.value.groups.find((g: any) => g.id === 32492);
    expect(copy.origin).toEqual(group.origin);
    expect(copy.removed).toBeUndefined();
    // Saved again with another forgery, the layer's copy still wins
    const again: any = await api.worldSetGroup({ ...copy, name: 'Path 1', origin: forged }, []);
    expect(again.value.groups.find((g: any) => g.id === 32492).origin).toEqual(group.origin);
    // An id with no pool and no layer copy is new, whatever the renderer says
    const ghost: any = await api.worldSetGroup({ id: 40000, name: 'Ghost', map: 0, maxActive: 1, origin: forged,
      members: [{ type: 'spawn', kind: 'npc', guid: 80330, entry: 32491, chance: 0 }] } as any, []);
    expect(ghost.ok).toBe(true);
    expect(ghost.value.groups.find((g: any) => g.id === 40000).origin).toEqual({ kind: 'new' });
  });
  it('gives a new group the next free id when the database has taken its id for a pool since', async () => {
    const { api, db } = await setup();
    db.insert('pool_template', { entry: '32494', max_limit: '1', description: 'Someone else' });
    const saved: any = await api.worldSetGroup({ id: 32494, name: 'Solo', map: 0, maxActive: 1, origin: { kind: 'new' },
      members: [{ type: 'spawn', kind: 'npc', guid: 80330, entry: 32491, chance: 0 }] } as any, []);
    expect(saved.ok).toBe(true);
    expect(saved.value.groups.map((g: any) => [g.id, g.name, g.origin.kind])).toEqual([[32495, 'Solo', 'new']]);
  });

  it('refuses to export a new group whose id the database now has, and saving the group again gives it a new id', async () => {
    const { api, db } = await setup();
    const inner = { id: 32494, name: 'Solo', map: 0, maxActive: 1, origin: { kind: 'new' }, members: [{ type: 'spawn', kind: 'npc', guid: 80330, entry: 32491, chance: 0 }] };
    expect(((await api.worldSetGroup(inner as any, [])) as any).ok).toBe(true);
    const outer = { id: 32496, name: 'Outer', map: 0, maxActive: 1, origin: { kind: 'new' }, members: [{ type: 'group', id: 32494, chance: 0 }] };
    expect(((await api.worldSetGroup(outer as any, [])) as any).ok).toBe(true);
    db.insert('pool_template', { entry: '32494', max_limit: '1', description: 'Someone else' });
    const out: any = await api.exportProject();
    expect(out.ok).toBe(false);
    expect(out.error.issues.map((i: any) => i.message)).toContain(
      'Spawn group "Solo": the database now has a pool with id 32494; open the group and save it again to give it a new id.');
    const copy: any = ((await api.worldGroup(32494)) as any).value;
    const again: any = await api.worldSetGroup(copy, []);
    expect(again.ok).toBe(true);
    expect(again.value.groups.map((g: any) => [g.id, g.name])).toEqual([[32496, 'Outer'], [32497, 'Solo']]);
    // The group holding it follows it to its new id
    expect(again.value.groups[0].members).toEqual([{ type: 'group', id: 32497, chance: 0 }]);
    expect(((await api.exportProject()) as any).ok).toBe(true);
  });
});
