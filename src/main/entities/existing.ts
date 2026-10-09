import { spawnEntryColumn } from '../../core/db/spawns';
import type { WorldDb } from '../../core/db/world-db';
import { readOriginalRows } from '../../core/entities/existing';
import type { OriginalRows } from '../../core/entities/model';
import { rowsOrNone } from '../../core/links/context';

type Kind = 'npc' | 'object' | 'item';

const num = (raw: string | null | undefined): number => {
  const n = Number(raw);
  return raw === null || raw === undefined || !Number.isFinite(n) ? 0 : n;
};
const str = (n: number): string => String(n);

async function spawnCountOf(db: WorldDb, table: 'creature' | 'gameobject', entry: number): Promise<number> {
  const columns = (await db.columns(table)).map((c) => c.name);
  if (columns.length === 0) return 0;
  const column = spawnEntryColumn(table, columns);
  return (await rowsOrNone(db, table, { [column]: str(entry) })).length;
}

/**
 * Who else uses what an NPC's gossip tree holds: for each menu the other creatures (by `gossip_menu_id`) and
 * objects (type 2 `Data3`) that use it, and for each text the menus outside the tree that use it
 */
async function gossipUsers(db: WorldDb, rows: OriginalRows, entry: number): Promise<{ sharedMenus: Record<number, number>; sharedTexts: Record<number, number> }> {
  const menus = [...new Set((rows.gossip_menu ?? []).map((r) => num(r.MenuID)).concat((rows.gossip_menu_option ?? []).map((r) => num(r.MenuID))).concat(num(rows.creature_template?.[0]?.gossip_menu_id)))].filter((id) => id > 0);
  const sharedMenus: Record<number, number> = {};
  const sharedTexts: Record<number, number> = {};
  if (menus.length === 0) return { sharedMenus, sharedTexts };
  const names = menus.map(str);
  const texts = [...new Set((rows.gossip_menu ?? []).map((r) => r.TextID ?? '0'))];
  const [creatures, objects, users, openers] = await Promise.all([
    rowsOrNone(db, 'creature_template', { gossip_menu_id: names }),
    rowsOrNone(db, 'gameobject_template', { type: '2', Data3: names }),
    texts.length > 0 ? rowsOrNone(db, 'gossip_menu', { TextID: texts }) : Promise.resolve([]),
    rowsOrNone(db, 'gossip_menu_option', { ActionMenuID: names }),
  ]);
  for (const r of creatures) if (num(r.entry) !== entry) sharedMenus[num(r.gossip_menu_id)] = (sharedMenus[num(r.gossip_menu_id)] ?? 0) + 1;
  for (const r of objects) sharedMenus[num(r.Data3)] = (sharedMenus[num(r.Data3)] ?? 0) + 1;
  // A menu outside the tree that opens one of its menus uses it too
  for (const r of openers) if (!menus.includes(num(r.MenuID))) sharedMenus[num(r.ActionMenuID)] = (sharedMenus[num(r.ActionMenuID)] ?? 0) + 1;
  for (const r of users) if (!menus.includes(num(r.MenuID))) sharedTexts[num(r.TextID)] = (sharedTexts[num(r.TextID)] ?? 0) + 1;
  return { sharedMenus, sharedTexts };
}

/**
 * The rows an existing NPC, object or item is made of, as the database has them now (see
 * `readOriginalRows`), with how many other entries share its loot and how many spawns it has; null
 * when it has none
 */
export async function readExistingRows(
  db: WorldDb, kind: Kind, entry: number,
): Promise<{
  rows: OriginalRows; sharedLoot: number; spawnCount: number; sharedTrainer: number;
  /** For each menu of its gossip tree, how many other creatures and objects use it */
  sharedMenus: Record<number, number>;
  /** For each text of its gossip tree, how many menus outside the tree use it */
  sharedTexts: Record<number, number>;
} | null> {
  const rows = await readOriginalRows(db, kind, entry);
  if (!rows) return null;
  if (kind === 'npc') {
    const lootid = num(rows.creature_template?.[0]?.lootid);
    const trainerId = rows.creature_default_trainer?.[0]?.TrainerId ?? null;
    const [sharing, spawnCount, trainerUsers] = await Promise.all([
      lootid > 0 ? rowsOrNone(db, 'creature_template', { lootid: str(lootid) }) : Promise.resolve([]),
      spawnCountOf(db, 'creature', entry),
      trainerId !== null ? rowsOrNone(db, 'creature_default_trainer', { TrainerId: trainerId }) : Promise.resolve([]),
    ]);
    const { sharedMenus, sharedTexts } = await gossipUsers(db, rows, entry);
    return { rows, sharedLoot: sharing.filter((r) => num(r.entry) !== entry).length, spawnCount, sharedTrainer: trainerUsers.filter((r) => num(r.CreatureId) !== entry).length, sharedMenus, sharedTexts };
  }
  if (kind === 'object') {
    const row = rows.gameobject_template?.[0] ?? {};
    const lootid = num(row.type) === 3 ? num(row.Data1) : 0;
    const [sharing, spawnCount] = await Promise.all([
      lootid > 0 ? rowsOrNone(db, 'gameobject_template', { type: '3', Data1: str(lootid) }) : Promise.resolve([]),
      spawnCountOf(db, 'gameobject', entry),
    ]);
    return { rows, sharedLoot: sharing.filter((r) => num(r.entry) !== entry).length, spawnCount, sharedTrainer: 0, sharedMenus: {}, sharedTexts: {} };
  }
  return { rows, sharedLoot: 0, spawnCount: 0, sharedTrainer: 0, sharedMenus: {}, sharedTexts: {} };
}
