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
 * The rows an existing NPC, object or item is made of, as the database has them now (see
 * `readOriginalRows`), with how many other entries share its loot and how many spawns it has; null
 * when it has none
 */
export async function readExistingRows(
  db: WorldDb, kind: Kind, entry: number,
): Promise<{ rows: OriginalRows; sharedLoot: number; spawnCount: number } | null> {
  const rows = await readOriginalRows(db, kind, entry);
  if (!rows) return null;
  if (kind === 'npc') {
    const lootid = num(rows.creature_template?.[0]?.lootid);
    const [sharing, spawnCount] = await Promise.all([
      lootid > 0 ? rowsOrNone(db, 'creature_template', { lootid: str(lootid) }) : Promise.resolve([]),
      spawnCountOf(db, 'creature', entry),
    ]);
    return { rows, sharedLoot: sharing.filter((r) => num(r.entry) !== entry).length, spawnCount };
  }
  if (kind === 'object') {
    const row = rows.gameobject_template?.[0] ?? {};
    const lootid = num(row.type) === 3 ? num(row.Data1) : 0;
    const [sharing, spawnCount] = await Promise.all([
      lootid > 0 ? rowsOrNone(db, 'gameobject_template', { type: '3', Data1: str(lootid) }) : Promise.resolve([]),
      spawnCountOf(db, 'gameobject', entry),
    ]);
    return { rows, sharedLoot: sharing.filter((r) => num(r.entry) !== entry).length, spawnCount };
  }
  return { rows, sharedLoot: 0, spawnCount: 0 };
}
