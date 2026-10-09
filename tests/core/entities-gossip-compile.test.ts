import { describe, expect, it } from 'vitest';
import { compileEntities } from '../../src/core/entities/compile';
import { EMPTY_ENTITY_CONTEXT, ENTITY_KEYS, readEntityContext } from '../../src/core/entities/context';
import { scriptStatements } from '../../src/core/scripts/statements';
import { loadSchema } from '../../src/core/schema/load';
import { newNpc, newSpawn, type CustomNpc, type GossipMenu } from '../../src/core/entities/model';
import { FakeWorldDb } from '../helpers/fake-world-db';
import { forkDb } from '../helpers/fixtures';

const root: GossipMenu = {
  menuId: 932535, textId: 9780013, locked: false,
  greeting: [{ text: 'Hail', textFemale: 'Hail, lady', probability: 1 }, { text: 'Well met', textFemale: '', probability: 0.5 }],
  options: [
    { optionId: 0, icon: 1, text: 'Browse', action: { kind: 'service', type: 3, npcFlag: 128 }, kept: false },
    { optionId: 1, icon: 0, text: 'More', action: { kind: 'menu', menuId: 932536 }, kept: false },
  ],
};
const sub: GossipMenu = { menuId: 932536, textId: 9780014, locked: false, greeting: [{ text: 'Farewell', textFemale: '', probability: 1 }], options: [{ optionId: 0, icon: 0, text: 'Bye', action: { kind: 'close' }, kept: false }] };
const host: CustomNpc = { ...newNpc(12000001), name: 'Hela', displayId: 1, gossip: true, spawns: [{ ...newSpawn(6000001) }], gossipMenu: { menus: [root, sub] } };
const plain: CustomNpc = { ...newNpc(12000002), name: 'Idle', displayId: 1 };
const compile = (npcs: CustomNpc[], context: typeof EMPTY_ENTITY_CONTEXT = EMPTY_ENTITY_CONTEXT) => compileEntities({ entities: { npcs, objects: [], items: [] }, givers: [], context });

describe('compiling a new NPC\'s gossip', () => {
  it('writes each menu, its text variants and its options, with the root as the NPC\'s gossip_menu_id', () => {
    const out = compile([host]);
    expect(out.inserts.gossip_menu).toEqual([{ MenuID: '932535', TextID: '9780013' }, { MenuID: '932536', TextID: '9780014' }]);
    expect(out.inserts.npc_text).toEqual([
      { ID: '9780013', text0_0: 'Hail', text0_1: 'Hail, lady', Probability0: '1', text1_0: 'Well met', text1_1: '', Probability1: '0.5' },
      { ID: '9780014', text0_0: 'Farewell', text0_1: '', Probability0: '1' },
    ]);
    expect(out.inserts.gossip_menu_option).toEqual([
      { MenuID: '932535', OptionID: '0', OptionIcon: '1', OptionText: 'Browse', OptionType: '3', OptionNpcFlag: '128', ActionMenuID: '0' },
      { MenuID: '932535', OptionID: '1', OptionIcon: '0', OptionText: 'More', OptionType: '1', OptionNpcFlag: '1', ActionMenuID: '932536' },
      { MenuID: '932536', OptionID: '0', OptionIcon: '0', OptionText: 'Bye', OptionType: '1', OptionNpcFlag: '1', ActionMenuID: '0' },
    ]);
    expect(out.inserts.creature_template![0]).toMatchObject({ gossip_menu_id: '932535', npcflag: '1' });
    expect(compile([plain]).inserts.creature_template![0]).toMatchObject({ gossip_menu_id: '0' });
  });

  it('leaves a locked menu out', () => {
    const out = compile([{ ...host, gossipMenu: { menus: [{ ...root, locked: true }, sub] } }]);
    expect(out.inserts.gossip_menu).toEqual([{ MenuID: '932536', TextID: '9780014' }]);
  });

  it('deletes what the NPC holds by key so a removed option, menu or variant is cleaned on re-export', () => {
    const out = compile([host]);
    expect(out.deletes.gossip_menu_option).toEqual([{ MenuID: '932535', OptionID: '0' }, { MenuID: '932535', OptionID: '1' }, { MenuID: '932536', OptionID: '0' }]);
    expect(out.deletes.gossip_menu).toEqual([{ MenuID: '932535', TextID: '9780013' }, { MenuID: '932536', TextID: '9780014' }]);
    expect(out.deletes.npc_text).toEqual([{ ID: '9780013' }, { ID: '9780014' }]);
  });

  it('also deletes options and menus a past export wrote that it no longer holds, but only on menus no one else uses', () => {
    const context = {
      ...EMPTY_ENTITY_CONTEXT,
      gossipOptions: [{ MenuID: '932535', OptionID: '5' }, { MenuID: '777', OptionID: '0' }, { MenuID: '932535', OptionID: '6' }],
      gossipUsers: [{ MenuID: '932535', Entry: '12000001' }, { MenuID: '777', Entry: '12000001' }, { MenuID: '777', Entry: '555' }],
      gossipScripted: [{ event_param1: '932535', event_param2: '6' }],
    };
    const out = compile([host], context);
    expect(out.deletes.gossip_menu_option).toContainEqual({ MenuID: '932535', OptionID: '5' });
    // a quest scene's scripted option stays
    expect(out.deletes.gossip_menu_option).not.toContainEqual({ MenuID: '932535', OptionID: '6' });
    // menu 777 is a creature outside the project's too
    expect(out.deletes.gossip_menu_option).not.toContainEqual({ MenuID: '777', OptionID: '0' });
  });

  it('removes the menu of an NPC that no longer has one, and never one NPCs outside the project use', () => {
    const context = {
      ...EMPTY_ENTITY_CONTEXT,
      creatures: [{ entry: '12000001', gossip_menu_id: '932535' }],
      gossipOptions: [{ MenuID: '932535', OptionID: '0' }, { MenuID: '777', OptionID: '0' }],
      gossipMenus: [{ MenuID: '932535', TextID: '9780013' }, { MenuID: '777', TextID: '555' }],
      gossipUsers: [{ MenuID: '932535', Entry: '12000001' }, { MenuID: '777', Entry: '12000001' }, { MenuID: '777', Entry: '555' }],
    };
    const out = compile([{ ...host, gossipMenu: null }], context);
    expect(out.deletes.gossip_menu_option).toEqual([{ MenuID: '932535', OptionID: '0' }]);
    expect(out.deletes.gossip_menu).toEqual([{ MenuID: '932535', TextID: '9780013' }]);
    expect(out.deletes.npc_text).toEqual([{ ID: '9780013' }]);
    // The id it pointed at is cleared with the menu; one it never owned is left to whoever set it
    expect(out.inserts.creature_template![0]).toMatchObject({ gossip_menu_id: '0' });
    const foreign = compile([{ ...host, gossipMenu: null }], { ...context, creatures: [{ entry: '12000001', gossip_menu_id: '777' }] });
    expect(foreign.inserts.creature_template![0]).toMatchObject({ gossip_menu_id: '777' });
  });

  it('never deletes a menu an object uses', () => {
    const context = {
      ...EMPTY_ENTITY_CONTEXT,
      gossipOptions: [{ MenuID: '932535', OptionID: '9' }],
      gossipUsers: [{ MenuID: '932535', Entry: '12000001' }, { MenuID: '932535', Entry: '-1' }],
    };
    expect(compile([host], context).deletes.gossip_menu_option).not.toContainEqual({ MenuID: '932535', OptionID: '9' });
  });

  it('is keyed correctly and ordered: options deleted before menus, inserted after the template', async () => {
    expect(ENTITY_KEYS.gossip_menu).toEqual(['MenuID', 'TextID']);
    expect(ENTITY_KEYS.gossip_menu_option).toEqual(['MenuID', 'OptionID']);
    expect(ENTITY_KEYS.npc_text).toEqual(['ID']);
    const tables = ['creature_template', 'creature_template_model', 'gossip_menu', 'gossip_menu_option', 'npc_text'];
    const schema = await loadSchema(FakeWorldDb.fromFork(tables), tables);
    const { statements } = scriptStatements(compile([host]), schema);
    const at = (kind: string, table: string) => statements.findIndex((s) => s.kind === kind && s.table === table);
    expect(at('delete', 'gossip_menu_option')).toBeLessThan(at('delete', 'gossip_menu'));
    expect(at('insert', 'creature_template')).toBeLessThan(at('insert', 'gossip_menu'));
    expect(at('insert', 'gossip_menu')).toBeGreaterThanOrEqual(0);
  });
});

describe('what the database holds for a new NPC\'s menus', () => {
  it('reads the options and menu rows of the menus it holds or points at, who uses them and which options a script names', async () => {
    const db = forkDb();
    db.insert('creature_template', { entry: '12000001', name: 'Hela', gossip_menu_id: '932535' });
    db.insert('creature_template', { entry: '555', name: 'Other', gossip_menu_id: '777' });
    db.insert('creature_template', { entry: '556', name: 'Third', gossip_menu_id: '777' });
    db.insert('gameobject_template', { entry: '100', type: '2', Data3: '932536' });
    db.insert('gossip_menu', { MenuID: '932535', TextID: '9780013' });
    db.insert('gossip_menu', { MenuID: '777', TextID: '555' });
    db.insert('gossip_menu_option', { MenuID: '932535', OptionID: '5', OptionText: 'Old' });
    db.insert('gossip_menu_option', { MenuID: '777', OptionID: '0', OptionText: 'Theirs' });
    db.insert('gossip_menu_option', { MenuID: '932536', OptionID: '0', OptionText: 'Sub' });
    db.insert('smart_scripts', { entryorguid: '12000001', source_type: '0', id: '0', link: '0', event_type: '62', event_param1: '932535', event_param2: '5' });
    const context = await readEntityContext(db, { npcs: [{ ...host, gossipMenu: { menus: [root, sub] } }, { ...plain, entry: 555 }], objects: [], items: [] }, []);
    expect(context.gossipOptions).toEqual(expect.arrayContaining([{ MenuID: '932535', OptionID: '5' }, { MenuID: '777', OptionID: '0' }, { MenuID: '932536', OptionID: '0' }]));
    expect(context.gossipMenus).toEqual(expect.arrayContaining([{ MenuID: '932535', TextID: '9780013' }, { MenuID: '777', TextID: '555' }]));
    expect(context.gossipUsers).toEqual(expect.arrayContaining([{ MenuID: '932535', Entry: '12000001' }, { MenuID: '777', Entry: '555' }, { MenuID: '777', Entry: '556' }, { MenuID: '932536', Entry: '-1' }]));
    expect(context.gossipScripted).toEqual([{ event_param1: '932535', event_param2: '5' }]);
  });
});
