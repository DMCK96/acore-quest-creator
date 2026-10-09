import type { WorldDb } from './world-db';
import { rowsOrNone } from './rows-or-none';

/** Where an object keeps its gossip menu id: questgivers in `Data3`, goobers in `Data19` */
export const OBJECT_MENU_COLUMNS = [['2', 'Data3'], ['10', 'Data19']] as const;

/** The gossip menu id of each object that uses one of `menus`, one entry per object (a menu with several objects repeats) */
export async function objectMenus(db: Pick<WorldDb, 'selectRows'>, menus: readonly string[]): Promise<number[]> {
  const found = await Promise.all(OBJECT_MENU_COLUMNS.map(([type, column]) => rowsOrNone(db, 'gameobject_template', { type, [column]: [...menus] }).then((rows) => rows.map((r) => Number(r[column] ?? 0)))));
  return found.flat();
}

/** The largest gossip menu id any object holds, 0 when none */
export async function maxObjectMenu(db: Pick<WorldDb, 'selectRows'>): Promise<number> {
  const found = await Promise.all(OBJECT_MENU_COLUMNS.map(([type, column]) => rowsOrNone(db, 'gameobject_template', { type }).then((rows) => rows.map((r) => Number(r[column] ?? 0)))));
  return Math.max(0, ...found.flat());
}
