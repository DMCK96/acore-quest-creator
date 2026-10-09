import type { GossipMenu, GossipTree } from './model';

/** The small steps of editing a gossip tree that do not depend on the screen */

/** A new menu with one blank greeting variant and no options */
export function blankMenu(menuId: number, textId: number): GossipMenu {
  return { menuId, textId, locked: false, greeting: [{ text: '', textFemale: '', probability: 1 }], options: [] };
}

/**
 * The id a new option takes: one above the menu's highest, 0 for the first; never a freed one (conditions and scripts
 * name ids), so `had` lists the ids the menu had when it was read
 */
export function nextOptionId(menu: GossipMenu, had: readonly number[] = []): number {
  const all = [...menu.options.map((o) => o.optionId), ...had];
  return all.length === 0 ? 0 : Math.max(...all) + 1;
}

/** The locked menus a menu reaches through its options, itself included when it is locked: what a copy of it has to take along */
export function reachableLocked(tree: GossipTree, fromId: number): number[] {
  const byId = new Map(tree.menus.map((m) => [m.menuId, m]));
  const found = new Set<number>();
  const visit = (id: number): void => {
    const m = byId.get(id);
    if (!m || !m.locked || found.has(id)) return;
    found.add(id);
    for (const o of m.options) if (o.action.kind === 'menu') visit(o.action.menuId);
  };
  visit(fromId);
  return tree.menus.map((m) => m.menuId).filter((id) => found.has(id));
}

/**
 * The tree with the chosen menus replaced by copies under the given new ids (in the order the menus are in the
 * tree): unlocked, their options not kept (a condition or a script names the old menu), their greetings copied
 * by value. Every option that opened a copied menu opens its copy.
 */
export function copyMenus(tree: GossipTree, which: readonly number[], ids: readonly { menu: number; text: number }[]): GossipTree {
  const chosen = tree.menus.filter((m) => which.includes(m.menuId));
  const moved = new Map(chosen.map((m, i) => [m.menuId, ids[i]!]));
  const menus = tree.menus.map((m): GossipMenu => {
    const to = moved.get(m.menuId);
    return {
      ...m,
      ...(to ? { menuId: to.menu, textId: to.text, locked: false } : {}),
      greeting: m.greeting.map((v) => ({ ...v })),
      options: m.options.map((o) => ({
        ...o,
        kept: to ? false : o.kept,
        action: o.action.kind === 'menu' && moved.has(o.action.menuId) ? { kind: 'menu' as const, menuId: moved.get(o.action.menuId)!.menu } : { ...o.action },
      })),
    };
  });
  return { menus };
}

/** Another NPC's whole tree as this NPC's own: every menu copied under new ids, none locked or kept */
export function freshTree(source: GossipTree, ids: readonly { menu: number; text: number }[]): GossipTree {
  return copyMenus(source, source.menus.map((m) => m.menuId), ids);
}
