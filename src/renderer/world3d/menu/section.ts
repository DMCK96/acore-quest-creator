import type { MenuSubject } from './subject';
import type { MenuContext, MenuGroup, MenuItem } from './model';
import { SECTIONS } from './sections';

/**
 * A slice of the 3D view's right-click menu: the subjects it is offered for, and its items. The menu
 * is every registered section that applies, its items joined by group in the order the sections run.
 */

export type MenuGroupId = 'busy' | 'world' | 'movement' | 'quest';

export interface MenuSection<S extends MenuSubject = MenuSubject> {
  id: string;
  group: MenuGroupId;
  appliesTo(subject: MenuSubject, context: MenuContext): subject is S;
  items(subject: S, context: MenuContext): MenuItem[];
}

export const NEEDS_GROUND = 'Right-click the ground';
export const NEEDS_DATABASE = 'Needs the world database';
export const COPY_FIRST = 'Copy something first';
export const WALKS_A_PATH = 'Walks a path: remove the path first';
export const ON_A_VESSEL = "Paths on a ship or zeppelin can't be edited yet";
export const OBJECTIVES_FULL = 'All four objectives are in use';

export function buildMenu(subject: MenuSubject, context: MenuContext, sections: readonly MenuSection[] = SECTIONS): MenuGroup[] {
  // While a path is drawn, clicks add points: nothing else is offered until it is finished
  const running = context.drawing ? sections.filter((s) => s.group === 'busy') : sections;
  const groups: MenuGroup[] = [];
  for (const section of running) {
    if (!section.appliesTo(subject, context)) continue;
    const items = section.items(subject, context);
    if (items.length === 0) continue;
    const group = groups.find((g) => g.id === section.group);
    if (group) group.items.push(...items);
    else groups.push({ id: section.group, items: [...items] });
  }
  return groups;
}
