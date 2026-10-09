import { describe, expect, it } from 'vitest';
import { entityIssues, type GossipFacts } from '../../src/core/entities/validate';
import { npcFromRows } from '../../src/core/entities/from-rows';
import { newNpc, newSpawn, type CustomNpc, type GossipMenu, type GossipOption } from '../../src/core/entities/model';

const close = (id: number, text = 'Bye', over: Partial<GossipOption> = {}): GossipOption => ({ optionId: id, icon: 0, text, action: { kind: 'close' }, kept: false, ...over });
const menu = (over: Partial<GossipMenu> = {}): GossipMenu => ({ menuId: 932535, textId: 9780013, locked: false, greeting: [{ text: 'Hail', textFemale: '', probability: 1 }], options: [close(0)], ...over });
const npc = (menus: GossipMenu[] | null, base: Partial<CustomNpc> = {}): CustomNpc =>
  ({ ...newNpc(12000001), name: 'Hela', displayId: 1, gossip: true, spawns: [{ ...newSpawn(1), x: 1 }], gossipMenu: menus ? { menus } : null, ...base });
const facts = (over: Partial<GossipFacts> = {}): GossipFacts => ({ menuUsers: new Map(), textMenus: new Map(), knownMenu: () => true, ...over });
const check = (n: CustomNpc | CustomNpc[], over: Partial<Parameters<typeof entityIssues>[0]> = {}) =>
  entityIssues({ entities: { npcs: Array.isArray(n) ? n : [n], objects: [], items: [] }, dbNames: new Map(), ...over });
const codes = (list: ReturnType<typeof check>) => list.map((i) => `${i.severity}:${i.code}`);
const users = (creatures: number[], objects = 0) => ({ creatures, objects });

describe('gossip checks', () => {
  it('accepts a clean tree', () => {
    expect(check(npc([menu()]), { gossipFacts: facts() })).toEqual([]);
    expect(check(npc(null))).toEqual([]);
  });
  it('errors on an id of 0, an option with no text, and a greeting nothing could pick', () => {
    expect(codes(check(npc([menu({ menuId: 0 })])))).toEqual(['error:GOSSIP_NO_ID']);
    expect(codes(check(npc([menu({ textId: 0 })])))).toEqual(['error:GOSSIP_NO_ID']);
    expect(codes(check(npc([menu({ options: [close(0, '  ')] })])))).toEqual(['error:GOSSIP_OPTION_NO_TEXT']);
    expect(codes(check(npc([menu({ greeting: [{ text: 'Hi', textFemale: '', probability: 0 }] })])))).toEqual(['error:GOSSIP_NO_GREETING']);
  });
  it('warns about a blank greeting variant', () => {
    expect(codes(check(npc([menu({ greeting: [{ text: '', textFemale: '', probability: 1 }] })])))).toEqual(['warning:GOSSIP_EMPTY_GREETING']);
  });
  it('warns about a menu no option reaches and an option opening a menu nothing has, only when it can tell', () => {
    const second = menu({ menuId: 932536, textId: 9780014 });
    expect(codes(check(npc([menu(), second])))).toEqual(['warning:GOSSIP_UNREACHABLE']);
    const opens = menu({ options: [{ ...close(0), action: { kind: 'menu', menuId: 777 } }] });
    expect(codes(check(npc([opens]), { gossipFacts: facts({ knownMenu: () => false }) }))).toEqual(['warning:GOSSIP_UNKNOWN_MENU']);
    expect(check(npc([opens]), { gossipFacts: null })).toEqual([]);
    expect(check(npc([menu({ options: [{ ...close(0), action: { kind: 'menu', menuId: 932536 } }] }), second]))).toEqual([]);
  });
  it('warns when a service needs a flag the NPC lacks, and not when it has it', () => {
    const vendorOption = (id: number): GossipOption => ({ optionId: id, icon: 1, text: 'Browse', action: { kind: 'service', type: 3, npcFlag: 128 }, kept: false });
    const withService = [menu({ options: [vendorOption(0)] })];
    expect(codes(check(npc(withService)))).toEqual(['warning:GOSSIP_SERVICE_FLAG']);
    expect(check(npc(withService, { vendor: [{ item: 1, maxCount: 0, restockSecs: 0, extendedCost: 0 }] }))).toEqual([]);
    const trainerOption: GossipOption = { optionId: 0, icon: 3, text: 'Train', action: { kind: 'service', type: 5, npcFlag: 16 }, kept: false };
    expect(codes(check(npc([menu({ options: [trainerOption] })])))).toEqual(['warning:GOSSIP_SERVICE_FLAG']);
    expect(check(npc([menu({ options: [trainerOption] })], { trainer: { trainerId: 2000000001, type: 'class', requirement: 1, greeting: '', spells: [{ spell: 1, cost: 0, reqLevel: 0, reqSkill: 0, reqSkillRank: 0, reqSpells: [] }] } }))).toEqual([]);
  });
  it('warns when players cannot open the menu, and when a quest scene has its own gossip option on the NPC', () => {
    expect(codes(check(npc([menu()], { gossip: false })))).toEqual(['warning:GOSSIP_NOT_TALKABLE']);
    expect(codes(check(npc([menu()]), { sceneGossipOwners: new Set([12000001]) }))).toEqual(['warning:GOSSIP_SCENE']);
    expect(check(npc([menu()]), { sceneGossipOwners: new Set([5]) })).toEqual([]);
  });
});

describe('gossip ids must be the NPC\'s own', () => {
  it('errors when another creature or an object already uses the menu id, or another menu the text', () => {
    expect(codes(check(npc([menu()]), { gossipFacts: facts({ menuUsers: new Map([[932535, users([555])]]) }) }))).toEqual(['error:GOSSIP_ID_TAKEN']);
    expect(codes(check(npc([menu()]), { gossipFacts: facts({ menuUsers: new Map([[932535, users([], 1)]]) }) }))).toEqual(['error:GOSSIP_ID_TAKEN']);
    expect(codes(check(npc([menu()]), { gossipFacts: facts({ textMenus: new Map([[9780013, [777]]]) }) }))).toEqual(['error:GOSSIP_ID_TAKEN']);
  });
  it('lets a new NPC re-export the menu and text it exported before', () => {
    expect(check(npc([menu()]), { gossipFacts: facts({ menuUsers: new Map([[932535, users([12000001])]]), textMenus: new Map([[9780013, [932535]]]) }) })).toEqual([]);
  });
  it('errors when two project NPCs hold the same new menu or text id', () => {
    const a = npc([menu()]);
    const b = npc([menu({ menuId: 932540 })], { entry: 12000002, name: 'Orrin' });
    const issues = check([a, b]);
    expect(codes(issues)).toEqual(['error:GOSSIP_ID_DUPLICATE', 'error:GOSSIP_ID_DUPLICATE']);
    expect(issues.map((i) => i.about?.entry)).toEqual([12000001, 12000002]);
  });
});

describe('a menu other NPCs use', () => {
  const rows = {
    creature_template: [{ entry: '12000001', gossip_menu_id: '5000' }],
    gossip_menu: [{ MenuID: '5000', TextID: '7000' }],
    npc_text: [{ ID: '7000', text0_0: 'Hello', Probability0: '1' }],
    gossip_menu_option: [
      { MenuID: '5000', OptionID: '0', OptionText: 'Bye', OptionType: '1', OptionNpcFlag: '1', ActionMenuID: '0', OptionIcon: '0' },
      { MenuID: '5000', OptionID: '1', OptionText: 'Scripted', OptionType: '1', OptionNpcFlag: '1', ActionMenuID: '0', OptionIcon: '0' },
    ],
    conditions: [], smart_scripts: [{ source_type: '0', event_type: '62', event_param1: '5000', event_param2: '1' }],
  };
  const counts = (shared: number) => ({ sharedLoot: 0, spawnCount: 1, sharedMenus: (shared ? { 5000: shared } : {}) as Record<number, number> });
  const read = (shared = 0, over: Partial<typeof rows> = {}): CustomNpc => ({ ...npcFromRows(12000001, { ...rows, ...over } as never, counts(shared)), name: 'Hela', displayId: 1, gossip: true });
  const edit = (n: CustomNpc, change: (m: GossipMenu) => GossipMenu): CustomNpc => ({ ...n, gossipMenu: { menus: n.gossipMenu!.menus.map(change) } });

  it('errors when an edit would be written over a menu others use now, whatever the lock says', () => {
    const edited = edit(read(0), (m) => ({ ...m, greeting: [{ ...m.greeting[0]!, text: 'Changed' }] }));
    expect(codes(check(edited, { gossipFacts: facts({ menuUsers: new Map([[5000, users([12000001, 555])]]) }) }))).toEqual(['error:GOSSIP_SHARED']);
    expect(check(edited, { gossipFacts: facts({ menuUsers: new Map([[5000, users([12000001])]]) }) })).toEqual([]);
  });
  it('warns that an edit to a locked menu is not written', () => {
    const locked = read(3);
    expect(codes(check(edit(locked, (m) => ({ ...m, greeting: [{ ...m.greeting[0]!, text: 'Changed' }] }))))).toEqual(['warning:GOSSIP_LOCKED']);
    expect(check(locked)).toEqual([]);
  });
  it('does not check a tree left as it was read, whatever quirks it has', () => {
    const quirky = read(0, { gossip_menu_option: [{ ...rows.gossip_menu_option[0]!, OptionText: '' }, rows.gossip_menu_option[1]!] });
    expect(check({ ...quirky, gossip: false })).toEqual([]);
  });
  it('errors when an option the database ties to a script, or its menu, is gone', () => {
    const dropped = edit(read(0), (m) => ({ ...m, options: m.options.filter((o) => !o.kept) }));
    expect(codes(check(dropped))).toEqual(['error:GOSSIP_KEPT_REMOVED']);
    const noMenu = { ...read(0), gossipMenu: null };
    expect(codes(check(noMenu))).toEqual(['error:GOSSIP_KEPT_REMOVED']);
    // Walking away from a shared menu deletes nothing
    expect(check({ ...read(3), gossipMenu: null })).toEqual([]);
  });
});

describe('gossip that was never read', () => {
  it('only says it is not written', () => {
    const origin = { kind: 'existing' as const, original: { creature_template: [] }, sharedLoot: 0, spawnCount: 1, locked: [] };
    expect(codes(check(npc([menu({ options: [close(0, '')] })], { origin })))).toEqual(['warning:GOSSIP_NOT_READ']);
    expect(check(npc(null, { origin }))).toEqual([]);
  });
});
