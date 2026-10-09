import { describe, expect, it } from 'vitest';
import { existingStatements } from '../../src/core/entities/existing';
import { npcFromRows } from '../../src/core/entities/from-rows';
import { nextOptionId } from '../../src/core/entities/gossip-tree';
import { compileEntities } from '../../src/core/entities/compile';
import { EMPTY_ENTITY_CONTEXT } from '../../src/core/entities/context';
import { entityIssues } from '../../src/core/entities/validate';
import { EMPTY_ENTITIES, newNpc, newSpawn, sameGossipMenu, type CustomNpc, type GossipMenu, type GossipOption } from '../../src/core/entities/model';

const template = { entry: '1423', name: 'Guard', subname: '', minlevel: '10', maxlevel: '10', faction: '11', rank: '0', type: '7', npcflag: '129', lootid: '0', AIName: '', ScriptName: '', gossip_menu_id: '5000' };
const model = { CreatureID: '1423', Idx: '0', CreatureDisplayID: '3167', DisplayScale: '1', Probability: '1' };
const menuRow = (id: string, text: string) => ({ MenuID: id, TextID: text, VerifiedBuild: '12340' });
const textRow = (id: string, over: Record<string, string | null> = {}) => ({ ID: id, text0_0: 'Hello', text0_1: '', BroadcastTextID0: '0', lang0: '0', Probability0: '1', text1_0: '', text1_1: '', BroadcastTextID1: '0', Probability1: '0', VerifiedBuild: '12340', ...over });
const optionRow = (menuId: string, id: string, over: Record<string, string | null> = {}) => ({ MenuID: menuId, OptionID: id, OptionIcon: '0', OptionText: 'Option', OptionBroadcastTextID: '0', OptionType: '1', OptionNpcFlag: '1', ActionMenuID: '0', ActionPoiID: '0', BoxCoded: '0', BoxMoney: '0', BoxText: null, BoxBroadcastTextID: '0', VerifiedBuild: '12340', ...over });
const rowsOf = (over: Record<string, unknown[]> = {}) => ({
  creature_template: [template], creature_template_model: [model],
  gossip_menu: [menuRow('5000', '7000'), menuRow('5001', '7001')],
  npc_text: [textRow('7000'), textRow('7001', { text0_0: 'Farewell' })],
  gossip_menu_option: [optionRow('5000', '0', { OptionText: 'More', ActionMenuID: '5001' }), optionRow('5001', '0', { OptionText: 'Bye' }), optionRow('5001', '1', { OptionText: 'Leave' })],
  conditions: [], smart_scripts: [], ...over,
});
const counts = { sharedLoot: 0, spawnCount: 1, sharedTrainer: 0 };
const TABLES = ['gossip_menu', 'gossip_menu_option', 'npc_text'];
const gossipStatements = (npc: CustomNpc) => existingStatements({ ...EMPTY_ENTITIES, npcs: [npc] }, []).apply.filter((s) => TABLES.includes(s.table));
const read = (rows: object = rowsOf(), c: object = counts) => npcFromRows(1423, rows as never, c as never);
const withMenu = (npc: CustomNpc, index: number, change: (m: GossipMenu) => GossipMenu): CustomNpc =>
  ({ ...npc, gossipMenu: { menus: npc.gossipMenu!.menus.map((m, i) => (i === index ? change(m) : m)) } });
const tied = { conditions: [{ SourceTypeOrReferenceId: '15', SourceGroup: '5001', SourceEntry: '0' }] };

describe('the kept options of a menu that is written', () => {
  it('stay in the database when the menu is edited around them', () => {
    const edited = withMenu(read(rowsOf(tied)), 1, (m) => ({ ...m, greeting: [{ ...m.greeting[0]!, text: 'Goodbye' }], options: [...m.options, { optionId: 2, icon: 0, text: 'New', action: { kind: 'close' }, kept: false }] }));
    const options = gossipStatements(edited).filter((s) => s.table === 'gossip_menu_option');
    // Option 0 is the kept one; the others are rewritten as they are
    expect(options.filter((s) => s.kind === 'delete').map((s) => (s as unknown as { key: { OptionID: string } }).key.OptionID)).toEqual(['1', '2']);
    expect(options.filter((s) => s.kind === 'insert').map((s) => (s as unknown as { row: { OptionID: string } }).row.OptionID)).toEqual(['1', '2']);
  });

  it('are rewritten, keeping the action they were read with, when their text changes', () => {
    const edited = withMenu(read(rowsOf(tied)), 1, (m) => ({ ...m, options: m.options.map((o) => (o.optionId === 0 ? { ...o, text: 'Farewell', action: { kind: 'menu' as const, menuId: 5000 } } : o)) }));
    const options = gossipStatements(edited).filter((s) => s.table === 'gossip_menu_option');
    expect(options).toContainEqual({ kind: 'delete', table: 'gossip_menu_option', key: { MenuID: '5001', OptionID: '0' } });
    expect(options).toContainEqual({ kind: 'insert', table: 'gossip_menu_option', row: optionRow('5001', '0', { OptionText: 'Farewell', OptionBroadcastTextID: '0' }) });
  });
});

describe('a menu whose text another menu of the tree also names', () => {
  const twin = rowsOf({ gossip_menu: [menuRow('5000', '7000'), menuRow('5001', '7000')], npc_text: [textRow('7000')] });
  it('is locked, so editing or removing one never rewrites or deletes the text of the other', () => {
    const npc = read(twin);
    expect(npc.gossipMenu!.menus.map((m) => m.locked)).toEqual([true, true]);
    expect(gossipStatements(withMenu(npc, 1, (m) => ({ ...m, greeting: [{ ...m.greeting[0]!, text: 'Changed' }] })))).toEqual([]);
    expect(gossipStatements({ ...npc, gossipMenu: { menus: [npc.gossipMenu!.menus[0]!] } })).toEqual([]);
  });
});

describe('the lock the database gave a menu', () => {
  it('holds whatever the editor or an assistant sends back in `locked`', () => {
    const shared = read(rowsOf(), { ...counts, sharedMenus: { 5000: 2 } });
    const unlocked = withMenu(shared, 0, (m) => ({ ...m, locked: false, greeting: [{ ...m.greeting[0]!, text: 'Changed' }] }));
    expect(gossipStatements(unlocked)).toEqual([]);
  });
});

describe('the order of a menu\'s options', () => {
  it('is not a change: the game shows them by id', () => {
    const npc = read();
    const m = npc.gossipMenu!.menus[1]!;
    expect(sameGossipMenu(m, { ...m, options: [...m.options].reverse() })).toBe(true);
    expect(gossipStatements(withMenu(npc, 1, (x) => ({ ...x, options: [...x.options].reverse() })))).toEqual([]);
  });
});

describe('a new option\'s id', () => {
  it('is never one the database held for the menu, even a highest one that was removed', () => {
    const menu = read().gossipMenu!.menus[1]!;
    expect(nextOptionId({ ...menu, options: menu.options.slice(0, 1) }, [0, 1])).toBe(2);
    expect(nextOptionId({ ...menu, options: [] }, [])).toBe(0);
  });
});

describe('removing a greeting variant', () => {
  it('resets the language and emotes of the slots, which belong to the slot and not the text', () => {
    const two = rowsOf({ npc_text: [textRow('7000', { text1_0: 'Again', Probability1: '1', lang0: '7', lang1: '1', Emote0_0: '5' }), textRow('7001')] });
    const npc = read(two);
    const edited = withMenu(npc, 0, (m) => ({ ...m, greeting: [m.greeting[1]!], options: [] }));
    const text = gossipStatements(edited).find((s) => s.table === 'npc_text' && s.kind === 'insert' && s.row.ID === '7000') as { row: Record<string, string | null> };
    expect(text.row).toMatchObject({ text0_0: 'Again', lang0: '0', Emote0_0: '0', Probability1: '0' });
  });
});

describe('an option whose text the database left NULL', () => {
  it('stays NULL when only its icon changes', () => {
    const nulled = rowsOf({ gossip_menu_option: [optionRow('5000', '0', { OptionText: null, ActionMenuID: '5001' }), optionRow('5001', '0')] });
    const edited = withMenu(read(nulled), 0, (m) => ({ ...m, options: [{ ...m.options[0]!, icon: 3 }] }));
    expect(gossipStatements(edited)).toContainEqual({ kind: 'insert', table: 'gossip_menu_option', row: optionRow('5000', '0', { OptionText: null, OptionIcon: '3', ActionMenuID: '5001' }) });
  });
});

const codesOf = (n: CustomNpc[]) => entityIssues({ entities: { npcs: n, objects: [], items: [] }, dbNames: new Map() }).map((i) => `${i.severity}:${i.code}`);
const asNpc = (npc: CustomNpc): CustomNpc => ({ ...npc, name: 'Guard', displayId: 1, gossip: true });
const close = (id: number, over: Partial<GossipOption> = {}): GossipOption => ({ optionId: id, icon: 0, text: 'Bye', action: { kind: 'close' }, kept: false, ...over });
const fresh = (menus: GossipMenu[]): CustomNpc => ({ ...newNpc(12000001), name: 'Hela', displayId: 1, gossip: true, spawns: [{ ...newSpawn(1), x: 1 }], gossipMenu: { menus } });
const newMenu = (over: Partial<GossipMenu> = {}): GossipMenu => ({ menuId: 932535, textId: 9780013, locked: false, greeting: [{ text: 'Hail', textFemale: '', probability: 1 }], options: [close(0)], ...over });

describe('the checks on gossip', () => {
  it('error on an edit to a menu the database locked, whatever the editor sends in locked', () => {
    const shared = asNpc(read(rowsOf(), { ...counts, sharedMenus: { 5000: 2 } }));
    const edited = withMenu(shared, 0, (m) => ({ ...m, locked: false, greeting: [{ ...m.greeting[0]!, text: 'Changed' }] }));
    expect(codesOf([edited])).toEqual(['warning:GOSSIP_LOCKED']);
  });
  it('error on an option that opens a menu the same edit removes', () => {
    const npc = asNpc(read());
    const dropped = { ...npc, gossipMenu: { menus: [npc.gossipMenu!.menus[0]!] } };
    expect(codesOf([dropped])).toEqual(['error:GOSSIP_REMOVED_MENU']);
  });
  it('let an NPC give up its whole menu even when an option in it is tied to a script', () => {
    expect(codesOf([{ ...asNpc(read(rowsOf(tied))), gossipMenu: null }])).toEqual([]);
  });
  it('error on two options of one menu with the same id', () => {
    expect(codesOf([fresh([newMenu({ options: [close(0), close(0)] })])])).toEqual(['error:GOSSIP_OPTION_DUPLICATE']);
  });
  it('warn about a service option with no NPC flag, which the server never shows', () => {
    const service = close(0, { action: { kind: 'service', type: 3, npcFlag: 0 } });
    expect(codesOf([fresh([newMenu({ options: [service] })])])).toEqual(['warning:GOSSIP_SERVICE_FLAG']);
  });
  it('do not check the ids of a locked menu a new NPC only points at', () => {
    const locked = newMenu({ menuId: 5000, textId: 7000, locked: true });
    const facts = { menuUsers: new Map([[5000, { creatures: [555], objects: 0 }]]), textMenus: new Map([[7000, [5000]]]), knownMenu: () => true };
    expect(entityIssues({ entities: { npcs: [fresh([locked])], objects: [], items: [] }, dbNames: new Map(), gossipFacts: facts }).map((i) => i.code)).toEqual([]);
  });
  it('name a duplicate menu id inside one NPC as another menu, not another NPC', () => {
    const issues = entityIssues({ entities: { npcs: [fresh([newMenu(), newMenu({ options: [close(0)] })])], objects: [], items: [] }, dbNames: new Map() });
    expect(issues.find((i) => i.code === 'GOSSIP_ID_DUPLICATE')!.message).toContain('another menu');
  });
});

describe('cleaning up a re-exported tree of a new NPC', () => {
  const sub = newMenu({ menuId: 932536, textId: 9780014, options: [close(0)] });
  const root = newMenu({ options: [close(0, { action: { kind: 'menu', menuId: 932536 } })] });
  const exported = {
    ...EMPTY_ENTITY_CONTEXT,
    creatures: [{ entry: '12000001', gossip_menu_id: '932535' }],
    gossipOptions: [{ MenuID: '932535', OptionID: '0', ActionMenuID: '932536' }, { MenuID: '932536', OptionID: '0', ActionMenuID: '0' }, { MenuID: '932536', OptionID: '1', ActionMenuID: '0' }],
    gossipMenus: [{ MenuID: '932535', TextID: '9780013' }, { MenuID: '932536', TextID: '9780014' }],
    gossipUsers: [{ MenuID: '932535', Entry: '12000001' }],
    gossipOpeners: [{ MenuID: '932535', ActionMenuID: '932536' }],
  };
  const compile = (npc: CustomNpc, context = exported) => compileEntities({ entities: { npcs: [npc], objects: [], items: [] }, givers: [], context });

  it('deletes an option removed from a sub-menu, and the rows of a sub-menu taken out of the tree', () => {
    expect(compile(fresh([root, sub])).deletes.gossip_menu_option).toContainEqual({ MenuID: '932536', OptionID: '1' });
    const out = compile(fresh([newMenu({ options: [close(0)] })]));
    expect(out.deletes.gossip_menu).toContainEqual({ MenuID: '932536', TextID: '9780014' });
    expect(out.deletes.npc_text).toContainEqual({ ID: '9780014' });
    expect(out.deletes.gossip_menu_option).toContainEqual({ MenuID: '932536', OptionID: '0' });
  });

  it('leaves a sub-menu alone when a menu outside the project also opens it, or something uses it as its menu', () => {
    const opened = { ...exported, gossipOpeners: [...exported.gossipOpeners, { MenuID: '4000', ActionMenuID: '932536' }] };
    expect(compile(fresh([newMenu({ options: [close(0)] })]), opened).deletes.gossip_menu).not.toContainEqual({ MenuID: '932536', TextID: '9780014' });
    const used = { ...exported, gossipUsers: [...exported.gossipUsers, { MenuID: '932536', Entry: '555' }] };
    expect(compile(fresh([newMenu({ options: [close(0)] })]), used).deletes.gossip_menu).not.toContainEqual({ MenuID: '932536', TextID: '9780014' });
  });
});
