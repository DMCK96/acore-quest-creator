import { describe, expect, it } from 'vitest';
import { blankMenu, copyMenus, freshTree, nextOptionId, reachableLocked } from '../../src/core/entities/gossip-tree';
import type { GossipMenu, GossipTree } from '../../src/core/entities/model';

const menu = (menuId: number, over: Partial<GossipMenu> = {}): GossipMenu => ({
  menuId, textId: menuId + 1000, locked: false, greeting: [{ text: `Menu ${menuId}`, textFemale: '', probability: 1 }], options: [], ...over,
});
const opens = (optionId: number, menuId: number, kept = false) => ({ optionId, icon: 0, text: 'More', action: { kind: 'menu' as const, menuId }, kept });
const tree = (): GossipTree => ({
  menus: [
    menu(1, { locked: true, options: [opens(0, 2, true), { optionId: 1, icon: 1, text: 'Browse', action: { kind: 'service', type: 3, npcFlag: 128 }, kept: false }] }),
    menu(2, { locked: true, options: [opens(0, 3)] }),
    menu(3, { options: [opens(0, 1)] }),
    menu(4, { locked: true }),
  ],
});

describe('building gossip menus', () => {
  it('makes a blank menu with one greeting variant and no options', () => {
    expect(blankMenu(7, 8)).toEqual({ menuId: 7, textId: 8, locked: false, greeting: [{ text: '', textFemale: '', probability: 1 }], options: [] });
  });
  it('gives a new option the id after the highest, 0 for the first, never a freed one', () => {
    expect(nextOptionId(menu(1))).toBe(0);
    expect(nextOptionId(menu(1, { options: [opens(0, 2), opens(5, 2)] }))).toBe(6);
  });
  it('finds the locked menus a menu reaches, itself included, and no unlocked or unreachable one', () => {
    expect(reachableLocked(tree(), 1)).toEqual([1, 2]);
    expect(reachableLocked(tree(), 2)).toEqual([2]);
    expect(reachableLocked(tree(), 3)).toEqual([]);
    expect(reachableLocked(tree(), 4)).toEqual([4]);
  });
});

describe('copying menus', () => {
  it('replaces the chosen menus with copies under new ids, unlocked and not kept, and repoints every option that opened them', () => {
    const copy = copyMenus(tree(), [1, 2], [{ menu: 10, text: 20 }, { menu: 11, text: 21 }]);
    expect(copy.menus.map((m) => [m.menuId, m.textId, m.locked])).toEqual([[10, 20, false], [11, 21, false], [3, 1003, false], [4, 1004, true]]);
    expect(copy.menus[0]!.options[0]).toEqual({ optionId: 0, icon: 0, text: 'More', action: { kind: 'menu', menuId: 11 }, kept: false });
    expect(copy.menus[0]!.options[1]!.action).toEqual({ kind: 'service', type: 3, npcFlag: 128 });
    // The menu that opened the root, outside the copy, now opens the copy
    expect(copy.menus[2]!.options[0]!.action).toEqual({ kind: 'menu', menuId: 10 });
    expect(copy.menus[1]!.options[0]!.action).toEqual({ kind: 'menu', menuId: 3 });
  });
  it('copies greetings by value, so editing one leaves the other', () => {
    const copy = copyMenus(tree(), [4], [{ menu: 12, text: 22 }]);
    copy.menus[3]!.greeting[0]!.text = 'Changed';
    expect(tree().menus[3]!.greeting[0]!.text).toBe('Menu 4');
  });
  it('makes a fresh tree of another NPC\'s: every menu new, none locked or kept, links followed', () => {
    const fresh = freshTree(tree(), [{ menu: 30, text: 40 }, { menu: 31, text: 41 }, { menu: 32, text: 42 }, { menu: 33, text: 43 }]);
    expect(fresh.menus.map((m) => [m.menuId, m.textId, m.locked])).toEqual([[30, 40, false], [31, 41, false], [32, 42, false], [33, 43, false]]);
    expect(fresh.menus.flatMap((m) => m.options.map((o) => o.kept))).not.toContain(true);
    expect(fresh.menus[0]!.options[0]!.action).toEqual({ kind: 'menu', menuId: 31 });
    expect(fresh.menus[2]!.options[0]!.action).toEqual({ kind: 'menu', menuId: 30 });
  });
});
