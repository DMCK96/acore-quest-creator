import { describe, expect, it } from 'vitest';
import { createApi } from '../../src/main/api';
import { openStore } from '../../src/main/store/store';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta } from '../../src/main/project/project-file';
import type { ProjectController } from '../../src/main/project/controller';
import { forkDb } from '../helpers/fixtures';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };

async function setup() {
  const db = forkDb();
  db.insert('creature_template', { entry: '1423', name: 'Stormwind Guard', minlevel: '55', maxlevel: '56', faction: '11', rank: '1', type: '7', npcflag: '0', lootid: '1423', AIName: '', ScriptName: '' });
  db.insert('creature_template', { entry: '68', name: 'City Guard', lootid: '1423' });
  db.insert('creature_template_model', { CreatureID: '1423', Idx: '0', CreatureDisplayID: '3167', DisplayScale: '1', Probability: '1' });
  db.insert('creature_loot_template', { Entry: '1423', Item: '2589', Reference: '0', Chance: '35', QuestRequired: '0', LootMode: '1', GroupId: '0', MinCount: '1', MaxCount: '2', Comment: '' });
  for (const guid of ['80330', '80331', '80332']) db.insert('creature', { guid, id1: '1423', map: '0', position_x: '0', position_y: '0', position_z: '0', orientation: '0' });
  const session = createProjectSession(defaultProjectMeta('P', 'C:\out'));
  const api = createApi({ store: openStore(':memory:', box), openWorldDb: async () => db, openDevDb: async () => { throw new Error('x'); },
    fs: { writeFile: async () => {}, ensureDir: async () => {}, listDir: async () => [] }, now: () => new Date('2026-10-05T12:00:00Z'), session, projects: {} as ProjectController });
  const rec: any = await api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p' });
  await api.connect(rec.value.id);
  return { api, db, session };
}

describe('editing an existing entity', () => {
  it('reads an NPC with its rows, how many spawns it has and how many others share its loot', async () => {
    const { api } = await setup();
    const out: any = await api.readExistingEntity('npc', 1423);
    expect(out.value).toMatchObject({ entry: 1423, name: 'Stormwind Guard', displayId: 3167, loot: [{ item: 2589 }],
      origin: { kind: 'existing', sharedLoot: 1, spawnCount: 3, locked: [] } });
    expect(out.value.origin.original.creature_template[0].name).toBe('Stormwind Guard');
  });

  it("reads an NPC's trainer and how many other NPCs share it", async () => {
    const { api, db } = await setup();
    db.insert('trainer', { Id: '5', Type: '0', Requirement: '1', Greeting: 'Hi', VerifiedBuild: '0' });
    db.insert('trainer', { Id: '6', Type: '2', Requirement: '0', Greeting: 'Craft', VerifiedBuild: '0' });
    db.insert('trainer_spell', { TrainerId: '5', SpellId: '78', MoneyCost: '100', ReqLevel: '4' });
    db.insert('trainer_spell', { TrainerId: '6', SpellId: '2018', MoneyCost: '50', ReqLevel: '1' });
    db.insert('creature_default_trainer', { CreatureId: '1423', TrainerId: '5' });
    db.insert('creature_default_trainer', { CreatureId: '68', TrainerId: '5' });
    const shared: any = await api.readExistingEntity('npc', 1423);
    expect(shared.value.origin).toMatchObject({ sharedTrainer: 1, locked: ['trainer'] });
    expect(shared.value.trainer).toMatchObject({ trainerId: 5, type: 'class', requirement: 1, spells: [{ spell: 78, cost: 100, reqLevel: 4 }] });
    db.insert('creature_default_trainer', { CreatureId: '4242', TrainerId: '6' });
    db.insert('creature_template', { entry: '4242', name: 'Alchemist', minlevel: '10', maxlevel: '10', faction: '35', rank: '0', type: '7', npcflag: '81' });
    const own: any = await api.readExistingEntity('npc', 4242);
    expect(own.value.origin).toMatchObject({ sharedTrainer: 0, locked: [] });
    expect(own.value.trainer).toMatchObject({ trainerId: 6, type: 'profession' });
  });

  it("reads an NPC's gossip tree and which of its menus and texts others use", async () => {
    const { api, db } = await setup();
    db.update('creature_template', { entry: '1423' }, { gossip_menu_id: '5000' });
    db.update('creature_template', { entry: '68' }, { gossip_menu_id: '5000' });
    db.insert('gossip_menu', { MenuID: '5000', TextID: '7000' });
    db.insert('gossip_menu', { MenuID: '5001', TextID: '7001' });
    db.insert('gossip_menu', { MenuID: '6000', TextID: '7001' });
    db.insert('npc_text', { ID: '7000', text0_0: 'Hello', Probability0: '1' });
    db.insert('npc_text', { ID: '7001', text0_0: 'Farewell', Probability0: '1' });
    db.insert('gossip_menu_option', { MenuID: '5000', OptionID: '0', OptionText: 'More', OptionType: '1', OptionNpcFlag: '1', ActionMenuID: '5001' });
    db.insert('gossip_menu_option', { MenuID: '5001', OptionID: '0', OptionText: 'Bye', OptionType: '1', OptionNpcFlag: '1' });
    db.insert('gameobject_template', { entry: '100', type: '2', Data3: '5001' });
    const shared: any = await api.readExistingEntity('npc', 1423);
    expect(shared.value.gossipMenu.menus.map((m: any) => [m.menuId, m.locked])).toEqual([[5000, true], [5001, true]]);
    db.insert('creature_template', { entry: '4242', name: 'Host', minlevel: '10', maxlevel: '10', faction: '35', rank: '0', type: '7', npcflag: '1', gossip_menu_id: '5500' });
    db.insert('gossip_menu', { MenuID: '5500', TextID: '7500' });
    db.insert('npc_text', { ID: '7500', text0_0: 'Mine', Probability0: '1' });
    const own: any = await api.readExistingEntity('npc', 4242);
    expect(own.value.gossipMenu.menus.map((m: any) => [m.menuId, m.locked])).toEqual([[5500, false]]);
    // Another menu that opens it is a user too
    db.insert('gossip_menu_option', { MenuID: '9000', OptionID: '0', OptionText: 'Go', OptionType: '1', OptionNpcFlag: '1', ActionMenuID: '5500' });
    const opened: any = await api.readExistingEntity('npc', 4242);
    expect(opened.value.gossipMenu.menus.map((m: any) => m.locked)).toEqual([true]);
    // A goober holds its menu in Data19, and is a user too
    db.insert('creature_template', { entry: '4343', name: 'Host2', minlevel: '10', maxlevel: '10', faction: '35', rank: '0', type: '7', npcflag: '1', gossip_menu_id: '5600' });
    db.insert('gossip_menu', { MenuID: '5600', TextID: '7600' });
    db.insert('npc_text', { ID: '7600', text0_0: 'Mine', Probability0: '1' });
    expect(((await api.readExistingEntity('npc', 4343)) as any).value.gossipMenu.menus.map((m: any) => m.locked)).toEqual([false]);
    db.insert('gameobject_template', { entry: '101', type: '10', Data19: '5600' });
    expect(((await api.readExistingEntity('npc', 4343)) as any).value.gossipMenu.menus.map((m: any) => m.locked)).toEqual([true]);
  });

  it('refuses one the database does not have', async () => {
    const { api } = await setup();
    const out: any = await api.readExistingEntity('npc', 4242);
    expect(out.ok).toBe(false);
    expect(out.error.message).toBe('Not in the database any more');
  });

  it('says which edited existing entities the database has moved off since', async () => {
    const { api, db } = await setup();
    const read: any = await api.readExistingEntity('npc', 1423);
    await api.putProjectEntities({ npcs: [{ ...read.value, minLevel: 60 }], objects: [], items: [] });
    expect(((await api.existingDrift()) as any).value).toEqual([]);
    db.update('creature_template', { entry: '1423' }, { maxlevel: '70' });
    expect(((await api.existingDrift()) as any).value).toEqual([{ kind: 'npc', entry: 1423 }]);
  });
});
