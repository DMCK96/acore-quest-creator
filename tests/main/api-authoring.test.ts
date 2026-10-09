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

async function setup(connect = true) {
  const db = forkDb();
  const api = createApi({
    store: openStore(':memory:', box), openWorldDb: async () => db, openDevDb: async () => { throw new Error('x'); },
    fs: { writeFile: async () => {}, ensureDir: async () => {}, listDir: async () => [] }, now: () => new Date(),
    session: createProjectSession(defaultProjectMeta('P', 'C:/out')), projects: {} as ProjectController,
  });
  const rec: any = await api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p' });
  if (connect) await api.connect(rec.value.id);
  return api;
}

describe('projectIssues', () => {
  it('answers NOT_CONNECTED before connecting', async () => {
    expect(await (await setup(false)).projectIssues()).toMatchObject({ ok: false, error: { code: 'NOT_CONNECTED' } });
  });

  it('is empty for a project with no new NPCs, objects or items', async () => {
    expect(await (await setup()).projectIssues()).toEqual({ ok: true, value: [] });
  });

  it("reports what is wrong with a new NPC, in the editor's words, naming the NPC", async () => {
    const api = await setup();
    await api.putProjectEntities({ npcs: [{ ...newNpc(90001), name: 'Captain Rellick' }], objects: [], items: [] });
    const out: any = await api.projectIssues();
    expect(out.ok).toBe(true);
    const noModel = out.value.find((i: any) => i.code === 'ENTITY_NO_MODEL');
    expect(noModel.severity).toBe('error');
    expect(noModel.message).toMatch(/^NPC "Captain Rellick":/);
  });

  it('warns about vendor stock that neither the database nor the project has', async () => {
    const db = forkDb();
    db.insert('item_template', { entry: '159', name: 'Refreshing Spring Water' });
    const api = createApi({
      store: openStore(':memory:', box), openWorldDb: async () => db, openDevDb: async () => { throw new Error('x'); },
      fs: { writeFile: async () => {}, ensureDir: async () => {}, listDir: async () => [] }, now: () => new Date(),
      session: createProjectSession(defaultProjectMeta('P', 'C:/out')), projects: {} as ProjectController,
    });
    const rec: any = await api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p' });
    await api.connect(rec.value.id);
    const stock = (item: number) => ({ item, maxCount: 0, restockSecs: 0, extendedCost: 0 });
    await api.putProjectEntities({ npcs: [{ ...newNpc(90001), name: 'Seller', displayId: 1, vendor: [stock(159), stock(999999)] }], objects: [], items: [] });
    const out: any = await api.projectIssues();
    const unknown = out.value.filter((i: any) => i.code === 'VENDOR_UNKNOWN_ITEM');
    expect(unknown).toHaveLength(1);
    expect(unknown[0].message).toContain('item 999999');
  });

  it("errors when a new NPC's trainer id is used by someone else, in the database or in the project, but not when it is its own", async () => {
    const db = forkDb();
    db.insert('trainer', { Id: '900033', Type: '0', Requirement: '1', Greeting: '', VerifiedBuild: '0' });
    db.insert('trainer', { Id: '900034', Type: '0', Requirement: '1', Greeting: '', VerifiedBuild: '0' });
    db.insert('creature_default_trainer', { CreatureId: '555', TrainerId: '900033' });
    db.insert('creature_default_trainer', { CreatureId: '90001', TrainerId: '900034' });
    const api = createApi({
      store: openStore(':memory:', box), openWorldDb: async () => db, openDevDb: async () => { throw new Error('x'); },
      fs: { writeFile: async () => {}, ensureDir: async () => {}, listDir: async () => [] }, now: () => new Date(),
      session: createProjectSession(defaultProjectMeta('P', 'C:/out')), projects: {} as ProjectController,
    });
    const rec: any = await api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p' });
    await api.connect(rec.value.id);
    const taught = (entry: number, trainerId: number) => ({ ...newNpc(entry), name: 'T' + entry, displayId: 1, trainer: { trainerId, type: 'profession' as const, requirement: 0, greeting: '', spells: [{ spell: 1, cost: 0, reqLevel: 0, reqSkill: 0, reqSkillRank: 0, reqSpells: [] }] } });
    // 90001 re-exports its own 900034; 90002 takes 555's 900033; 90003 is free; 90004 also wants 90001's 900034
    await api.putProjectEntities({ npcs: [taught(90001, 900034), taught(90002, 900033), taught(90003, 900035), taught(90004, 900034)], objects: [], items: [] });
    const issues = (await api.projectIssues() as any).value;
    const taken = issues.filter((i: any) => i.code === 'TRAINER_ID_TAKEN');
    expect(taken.map((i: any) => [i.about.entry, i.severity])).toEqual([[90002, 'error'], [90004, 'error']]);
    const duplicate = issues.filter((i: any) => i.code === 'TRAINER_ID_DUPLICATE');
    expect(duplicate.map((i: any) => i.about.entry)).toEqual([90001, 90004]);
  });

  it('errors when an existing NPC\'s trainer would be written over while others use it, though its lock was dropped', async () => {
    const db = forkDb();
    db.insert('creature_template', { entry: '198', name: 'Warrior Trainer', minlevel: '30', maxlevel: '30', faction: '11', rank: '0', type: '7', npcflag: '51' });
    db.insert('trainer', { Id: '17', Type: '0', Requirement: '1', Greeting: 'Hi', VerifiedBuild: '0' });
    db.insert('trainer_spell', { TrainerId: '17', SpellId: '78', MoneyCost: '10', ReqLevel: '1' });
    db.insert('creature_default_trainer', { CreatureId: '198', TrainerId: '17' });
    db.insert('creature_default_trainer', { CreatureId: '199', TrainerId: '17' });
    const api = createApi({
      store: openStore(':memory:', box), openWorldDb: async () => db, openDevDb: async () => { throw new Error('x'); },
      fs: { writeFile: async () => {}, ensureDir: async () => {}, listDir: async () => [] }, now: () => new Date(),
      session: createProjectSession(defaultProjectMeta('P', 'C:/out')), projects: {} as ProjectController,
    });
    const rec: any = await api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p' });
    await api.connect(rec.value.id);
    const read: any = await api.readExistingEntity('npc', 198);
    expect(read.value.origin.locked).toContain('trainer');
    const unlocked = { ...read.value, trainer: { ...read.value.trainer, greeting: 'Changed' }, origin: { ...read.value.origin, locked: [] } };
    await api.putProjectEntities({ npcs: [unlocked], objects: [], items: [] });
    const shared = (await api.projectIssues() as any).value.filter((i: any) => i.code === 'TRAINER_SHARED');
    expect(shared).toHaveLength(1);
    expect(shared[0].severity).toBe('error');
  });

  describe('gossip menus', () => {
    const connect = async (db: ReturnType<typeof forkDb>) => {
      const api = createApi({
        store: openStore(':memory:', box), openWorldDb: async () => db, openDevDb: async () => { throw new Error('x'); },
        fs: { writeFile: async () => {}, ensureDir: async () => {}, listDir: async () => [] }, now: () => new Date(),
        session: createProjectSession(defaultProjectMeta('P', 'C:/out')), projects: {} as ProjectController,
      });
      const rec: any = await api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p' });
      await api.connect(rec.value.id);
      return api;
    };
    const menuFor = (entry: number, menuId: number, textId: number) => ({
      ...newNpc(entry), name: 'T' + entry, displayId: 1, gossip: true,
      gossipMenu: { menus: [{ menuId, textId, locked: false, greeting: [{ text: 'Hi', textFemale: '', probability: 1 }], options: [{ optionId: 0, icon: 0, text: 'Bye', action: { kind: 'close' as const }, kept: false }] }] },
    });

    it('errors when a new NPC uses a menu or text id that is not its own, but not when it re-exports its own', async () => {
      const db = forkDb();
      db.insert('creature_template', { entry: '555', name: 'Other', gossip_menu_id: '932533' });
      db.insert('gossip_menu', { MenuID: '932533', TextID: '9780010' });
      db.insert('creature_template', { entry: '90001', name: 'Mine', gossip_menu_id: '932534' });
      db.insert('gossip_menu', { MenuID: '932534', TextID: '9780011' });
      db.insert('gossip_menu', { MenuID: '932600', TextID: '9780012' });
      const api = await connect(db);
      // 90001 re-exports its own menu; 90002 takes 555's menu; 90003 is free; 90004 takes a text another menu uses; 90005 repeats 90003's ids
      await api.putProjectEntities({ npcs: [menuFor(90001, 932534, 9780011), menuFor(90002, 932533, 9780020), menuFor(90003, 932535, 9780021), menuFor(90004, 932536, 9780012), menuFor(90005, 932535, 9780021)], objects: [], items: [] });
      const issues = (await api.projectIssues() as any).value;
      const taken = issues.filter((i: any) => i.code === 'GOSSIP_ID_TAKEN');
      expect(taken.map((i: any) => i.about.entry)).toEqual([90002, 90004]);
      expect(taken.every((i: any) => i.severity === 'error')).toBe(true);
      const duplicate = issues.filter((i: any) => i.code === 'GOSSIP_ID_DUPLICATE');
      expect(duplicate.map((i: any) => i.about.entry)).toEqual([90003, 90003, 90005, 90005]);
    });

    it('errors when an existing NPC edited menu would be written over while another NPC now uses it', async () => {
      const db = forkDb();
      db.insert('creature_template', { entry: '198', name: 'Host', minlevel: '30', maxlevel: '30', faction: '35', rank: '0', type: '7', npcflag: '1', gossip_menu_id: '5000' });
      db.insert('gossip_menu', { MenuID: '5000', TextID: '7000' });
      db.insert('npc_text', { ID: '7000', text0_0: 'Hello', Probability0: '1' });
      db.insert('gossip_menu_option', { MenuID: '5000', OptionID: '0', OptionText: 'Bye', OptionType: '1', OptionNpcFlag: '1' });
      const api = await connect(db);
      const read: any = await api.readExistingEntity('npc', 198);
      expect(read.value.gossipMenu.menus[0].locked).toBe(false);
      const edited = { ...read.value, gossipMenu: { menus: read.value.gossipMenu.menus.map((m: any) => ({ ...m, greeting: [{ ...m.greeting[0], text: 'Changed' }] })) } };
      await api.putProjectEntities({ npcs: [edited], objects: [], items: [] });
      expect(((await api.projectIssues() as any).value).filter((i: any) => i.code === 'GOSSIP_SHARED')).toEqual([]);
      // Another creature starts to use the menu after the NPC was opened
      db.insert('creature_template', { entry: '199', name: 'Twin', gossip_menu_id: '5000' });
      const shared = ((await api.projectIssues() as any).value).filter((i: any) => i.code === 'GOSSIP_SHARED');
      expect(shared).toHaveLength(1);
      expect(shared[0].severity).toBe('error');
    });

    it('warns about a quest scene that gives the NPC its own gossip option', async () => {
      const api = await connect(forkDb());
      await api.putProjectEntities({ npcs: [menuFor(90001, 932535, 9780021)], objects: [], items: [] });
      const opened: any = await api.newQuest();
      const aggregate = opened.value.aggregate;
      aggregate.values.scripts = [{ id: 's1', name: '', owner: { kind: 'creature', entry: 90001 }, trigger: { kind: 'gossipOption', text: 'Ready.', greeting: 'Hi.' }, gates: [], steps: [{ kind: 'closeGossip', waitMs: 0 }] }];
      await api.updateQuest(aggregate);
      expect(((await api.projectIssues() as any).value).some((i: any) => i.code === 'GOSSIP_SCENE')).toBe(true);
    });
  });


  it('takes no arguments', () => {
    expect(parseRequest('projectIssues', []).ok).toBe(true);
    expect(parseRequest('projectIssues', [1]).ok).toBe(false);
  });
});
