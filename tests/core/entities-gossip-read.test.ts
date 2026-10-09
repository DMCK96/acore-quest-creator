import { describe, expect, it } from 'vitest';
import { npcFromRows } from '../../src/core/entities/from-rows';
import { readOriginalRows } from '../../src/core/entities/existing';
import { gossipUnread, newNpc, projectEntitiesSchema, readProjectEntities, sameGossip } from '../../src/core/entities/model';
import { FakeWorldDb } from '../helpers/fake-world-db';
import { forkDb } from '../helpers/fixtures';

const counts = { sharedLoot: 0, spawnCount: 1, sharedTrainer: 0 };
const template = { entry: '1423', name: 'Guard', subname: '', minlevel: '10', maxlevel: '10', faction: '11', rank: '0', type: '7', npcflag: '129', lootid: '0', AIName: '', ScriptName: '', gossip_menu_id: '5000' };
const menu = (id: string, text: string) => ({ MenuID: id, TextID: text });
const text = (id: string, over: Record<string, string> = {}) => ({ ID: id, text0_0: 'Hello', text0_1: 'Hello, lady', BroadcastTextID0: '123', lang0: '0', Probability0: '1', text1_0: '', text1_1: '', BroadcastTextID1: '0', Probability1: '0', VerifiedBuild: '12340', ...over });
const option = (menuId: string, id: string, over: Record<string, string | null> = {}) => ({ MenuID: menuId, OptionID: id, OptionIcon: '0', OptionText: 'Option', OptionBroadcastTextID: '0', OptionType: '1', OptionNpcFlag: '1', ActionMenuID: '0', ActionPoiID: '0', BoxCoded: '0', BoxMoney: '0', BoxText: null, BoxBroadcastTextID: '0', VerifiedBuild: '12340', ...over });
const rows = {
  creature_template: [template],
  gossip_menu: [menu('5000', '7000'), menu('5001', '7001')],
  npc_text: [text('7000'), text('7001', { text0_0: 'Farewell', text0_1: '', BroadcastTextID0: '0' })],
  gossip_menu_option: [
    option('5000', '1', { OptionText: 'Tell me more', ActionMenuID: '5001' }),
    option('5000', '0', { OptionText: 'Browse your wares', OptionIcon: '1', OptionType: '3', OptionNpcFlag: '128', OptionBroadcastTextID: '55' }),
    option('5001', '0', { OptionText: 'Goodbye' }),
  ],
  conditions: [] as Record<string, string>[],
  smart_scripts: [] as Record<string, string>[],
};

describe('reading an existing NPC\'s gossip tree', () => {
  it('reads the root and the menus its options open, with greeting variants and options by id', () => {
    const npc = npcFromRows(1423, rows, counts);
    expect(npc.gossipMenu!.menus.map((m) => m.menuId)).toEqual([5000, 5001]);
    expect(npc.gossipMenu!.menus[0]).toEqual({
      menuId: 5000, textId: 7000, locked: false,
      greeting: [{ text: 'Hello', textFemale: 'Hello, lady', probability: 1 }],
      options: [
        { optionId: 0, icon: 1, text: 'Browse your wares', action: { kind: 'service', type: 3, npcFlag: 128 }, kept: false },
        { optionId: 1, icon: 0, text: 'Tell me more', action: { kind: 'menu', menuId: 5001 }, kept: false },
      ],
    });
    expect(npc.gossipMenu!.menus[1]!.options).toEqual([{ optionId: 0, icon: 0, text: 'Goodbye', action: { kind: 'close' }, kept: false }]);
    expect(npc.origin).toMatchObject({ kind: 'existing', original: rows });
  });

  it('reads several weighted variants up to the last used one, and a blank one for a missing text row', () => {
    const many = { ...rows, npc_text: [text('7000', { text1_0: 'Again', Probability1: '0.5' }), text('7001')] };
    expect(npcFromRows(1423, many, counts).gossipMenu!.menus[0]!.greeting).toEqual([
      { text: 'Hello', textFemale: 'Hello, lady', probability: 1 },
      { text: 'Again', textFemale: '', probability: 0.5 },
    ]);
    const missing = npcFromRows(1423, { ...rows, npc_text: [text('7001')] }, counts).gossipMenu!.menus[0]!;
    expect(missing.greeting).toEqual([{ text: '', textFemale: '', probability: 1 }]);
    expect(missing.locked).toBe(true);
  });

  it('is null for an NPC with no menu or whose gossip was not read', () => {
    expect(npcFromRows(1423, { ...rows, creature_template: [{ ...template, gossip_menu_id: '0' }] }, counts).gossipMenu).toBeNull();
    expect(npcFromRows(1423, { creature_template: [template] }, counts).gossipMenu).toBeNull();
  });

  it('follows a loop once and stops at 24 menus, keeping the rest as bare ids', () => {
    const loop = { ...rows, gossip_menu_option: [option('5000', '0', { ActionMenuID: '5001' }), option('5001', '0', { ActionMenuID: '5000' })] };
    expect(npcFromRows(1423, loop, counts).gossipMenu!.menus).toHaveLength(2);
    const ids = Array.from({ length: 30 }, (_, i) => String(6000 + i));
    const chain = {
      creature_template: [{ ...template, gossip_menu_id: ids[0]! }],
      gossip_menu: ids.map((id, i) => menu(id, String(8000 + i))),
      npc_text: ids.map((_, i) => text(String(8000 + i))),
      gossip_menu_option: ids.map((id, i) => option(id, '0', { ActionMenuID: ids[i + 1] ?? '0' })),
    };
    const tree = npcFromRows(1423, chain, counts).gossipMenu!;
    expect(tree.menus).toHaveLength(24);
    expect(tree.menus[23]!.options[0]!.action).toEqual({ kind: 'menu', menuId: 6024 });
  });

  it('locks a menu others use, one whose text others use, one with several text rows, one with a text condition, and one with no text row', () => {
    const shared = npcFromRows(1423, rows, { ...counts, sharedMenus: { 5000: 2 } }).gossipMenu!.menus;
    // (the menu it opens is used by everyone who uses it)
    expect(shared.map((m) => m.locked)).toEqual([true, true]);
    expect(npcFromRows(1423, rows, { ...counts, sharedTexts: { 7001: 1 } }).gossipMenu!.menus.map((m) => m.locked)).toEqual([false, true]);
    const twoTexts = { ...rows, gossip_menu: [menu('5000', '7000'), menu('5000', '7002'), menu('5001', '7001')] };
    expect(npcFromRows(1423, twoTexts, counts).gossipMenu!.menus[0]).toMatchObject({ textId: 7000, locked: true });
    const conditioned = { ...rows, conditions: [{ SourceTypeOrReferenceId: '14', SourceGroup: '5000', SourceEntry: '7000' }] };
    expect(npcFromRows(1423, conditioned, counts).gossipMenu!.menus.map((m) => m.locked)).toEqual([true, true]);
  });

  it('keeps an option a condition or a gossip-select script names', () => {
    const tied = {
      ...rows,
      conditions: [{ SourceTypeOrReferenceId: '15', SourceGroup: '5000', SourceEntry: '1' }],
      smart_scripts: [{ entryorguid: '1423', source_type: '0', event_type: '62', event_param1: '5000', event_param2: '0' }],
    };
    expect(npcFromRows(1423, tied, counts).gossipMenu!.menus[0]!.options.map((o) => o.kept)).toEqual([true, true]);
    expect(npcFromRows(1423, rows, counts).gossipMenu!.menus[0]!.options.map((o) => o.kept)).toEqual([false, false]);
  });

  it('a new NPC and one saved before gossip have no menu; bad values are refused', () => {
    expect(newNpc(1).gossipMenu).toBeNull();
    const { gossipMenu: _g, ...old } = newNpc(7);
    expect(readProjectEntities({ npcs: [old], objects: [], items: [] }).npcs[0]!.gossipMenu).toBeNull();
    const menuOf = (over: object) => ({ ...newNpc(7), gossipMenu: { menus: [{ menuId: 1, textId: 2, greeting: [{ text: 'Hi', textFemale: '', probability: 1 }], options: [], locked: false, ...over }] } });
    const ok = (npc: object) => projectEntitiesSchema.safeParse({ npcs: [npc], objects: [], items: [] }).success;
    expect(ok(menuOf({}))).toBe(true);
    expect(ok(menuOf({ greeting: [] }))).toBe(false);
    expect(ok(menuOf({ greeting: Array.from({ length: 9 }, () => ({ text: 'x', textFemale: '', probability: 1 })) }))).toBe(false);
    expect(ok(menuOf({ options: [{ optionId: 0, icon: 0, text: 'x', action: { kind: 'menu', menuId: 0 }, kept: false }] }))).toBe(false);
  });

  it('knows gossip never read from gossip that was, and compares trees by value', () => {
    const npc = npcFromRows(1423, rows, counts);
    expect(gossipUnread(npc)).toBe(false);
    const { gossip_menu: _k, ...unread } = rows;
    expect(gossipUnread(npcFromRows(1423, unread, counts))).toBe(true);
    expect(gossipUnread(newNpc(1))).toBe(false);
    const again = npcFromRows(1423, rows, counts).gossipMenu;
    expect(sameGossip(npc.gossipMenu, again)).toBe(true);
    expect(sameGossip(npc.gossipMenu, null)).toBe(false);
    expect(sameGossip(null, null)).toBe(true);
    const edited = structuredClone(again!);
    edited.menus[0]!.options[0]!.text = 'Changed';
    expect(sameGossip(npc.gossipMenu, edited)).toBe(false);
    const lockedOnly = structuredClone(again!);
    lockedOnly.menus[0]!.locked = true;
    expect(sameGossip(npc.gossipMenu, lockedOnly)).toBe(true);
  });
});

describe('the rows an existing NPC\'s gossip is read from', () => {
  const fill = (db: FakeWorldDb) => {
    db.insert('creature_template', template);
    db.insert('gossip_menu', menu('5000', '7000'));
    db.insert('gossip_menu', menu('5001', '7001'));
    db.insert('gossip_menu', menu('9999', '7999'));
    db.insert('npc_text', { ID: '7000', text0_0: 'Hello', Probability0: '1' });
    db.insert('npc_text', { ID: '7001', text0_0: 'Farewell', Probability0: '1' });
    db.insert('npc_text', { ID: '7999', text0_0: 'Elsewhere', Probability0: '1' });
    db.insert('gossip_menu_option', { MenuID: '5000', OptionID: '0', OptionText: 'More', OptionType: '1', OptionNpcFlag: '1', ActionMenuID: '5001' });
    db.insert('gossip_menu_option', { MenuID: '5001', OptionID: '0', OptionText: 'Bye', OptionType: '1', OptionNpcFlag: '1' });
    db.insert('gossip_menu_option', { MenuID: '9999', OptionID: '0', OptionText: 'Elsewhere', OptionType: '1', OptionNpcFlag: '1' });
    db.insert('conditions', { SourceTypeOrReferenceId: '15', SourceGroup: '5000', SourceEntry: '0' });
    db.insert('conditions', { SourceTypeOrReferenceId: '15', SourceGroup: '9999', SourceEntry: '0' });
    db.insert('conditions', { SourceTypeOrReferenceId: '19', SourceGroup: '5000', SourceEntry: '0' });
    db.insert('smart_scripts', { entryorguid: '1423', source_type: '0', id: '0', link: '0', event_type: '62', event_param1: '5001', event_param2: '0' });
    db.insert('smart_scripts', { entryorguid: '1423', source_type: '0', id: '1', link: '0', event_type: '4', event_param1: '5001', event_param2: '0' });
  };

  it('reads the tree\'s menu, option and text rows, and only the conditions and scripts that name those menus', async () => {
    const db = forkDb();
    fill(db);
    const read = await readOriginalRows(db, 'npc', 1423);
    expect(read!.gossip_menu!.map((r) => r.MenuID)).toEqual(['5000', '5001']);
    expect(read!.gossip_menu_option!.map((r) => `${r.MenuID}/${r.OptionID}`)).toEqual(['5000/0', '5001/0']);
    expect(read!.npc_text!.map((r) => r.ID)).toEqual(['7000', '7001']);
    expect(read!.conditions!.map((r) => `${r.SourceTypeOrReferenceId}/${r.SourceGroup}`)).toEqual(['15/5000']);
    expect(read!.smart_scripts!.map((r) => `${r.event_type}/${r.event_param1}`)).toEqual(['62/5001']);
  });

  it('reads empty gossip lists for an NPC with no menu, so it counts as read', async () => {
    const db = forkDb();
    fill(db);
    db.insert('creature_template', { ...template, entry: '999', gossip_menu_id: '0' });
    const read = await readOriginalRows(db, 'npc', 999);
    expect(read).toMatchObject({ gossip_menu: [], gossip_menu_option: [], npc_text: [] });
  });

  it('leaves the keys out when the fork has no gossip tables, so gossip is never written', async () => {
    const db = FakeWorldDb.fromFork(['creature_template', 'creature_template_model', 'creature_equip_template', 'creature_loot_template', 'creature', 'game_event_creature']);
    db.insert('creature_template', template);
    const read = await readOriginalRows(db, 'npc', 1423);
    for (const key of ['gossip_menu', 'gossip_menu_option', 'npc_text']) expect(read).not.toHaveProperty(key);
  });
});
