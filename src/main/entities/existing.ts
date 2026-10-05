import { spawnEntryColumn } from '../../core/db/spawns';
import type { RawRow } from '../../core/db/types';
import type { WorldDb } from '../../core/db/world-db';
import type { CustomItem, CustomNpc, CustomObject, OriginalRows } from '../../core/entities/model';
import { rowsOrNone } from '../../core/links/context';

type Kind = 'npc' | 'object' | 'item';

const num = (raw: string | null | undefined): number => {
  const n = Number(raw);
  return raw === null || raw === undefined || !Number.isFinite(n) ? 0 : n;
};
const str = (n: number): string => String(n);

/** The rows of a page chain starting at `first`, following `NextPageID` */
async function pageRows(db: WorldDb, first: number): Promise<RawRow[]> {
  const rows: RawRow[] = [];
  const seen = new Set<number>();
  for (let id = first; id > 0 && !seen.has(id); ) {
    seen.add(id);
    const [row] = await rowsOrNone(db, 'page_text', { ID: str(id) });
    if (!row) break;
    rows.push(row);
    id = num(row.NextPageID);
  }
  return rows;
}

async function spawnCountOf(db: WorldDb, table: 'creature' | 'gameobject', entry: number): Promise<number> {
  const columns = (await db.columns(table)).map((c) => c.name);
  if (columns.length === 0) return 0;
  const column = spawnEntryColumn(table, columns);
  return (await rowsOrNone(db, table, { [column]: str(entry) })).length;
}

/** The rows an existing NPC, object or item is made of, as the database has them now; null when it has none */
export async function readExistingRows(
  db: WorldDb, kind: Kind, entry: number,
): Promise<{ rows: OriginalRows; sharedLoot: number; spawnCount: number } | null> {
  const key = str(entry);
  if (kind === 'npc') {
    const template = await rowsOrNone(db, 'creature_template', { entry: key });
    if (template.length === 0) return null;
    const lootid = num(template[0]!.lootid);
    const [models, equip, loot, sharing, spawnCount] = await Promise.all([
      rowsOrNone(db, 'creature_template_model', { CreatureID: key }),
      rowsOrNone(db, 'creature_equip_template', { CreatureID: key, ID: '1' }),
      lootid > 0 ? rowsOrNone(db, 'creature_loot_template', { Entry: str(lootid) }) : Promise.resolve([]),
      lootid > 0 ? rowsOrNone(db, 'creature_template', { lootid: str(lootid) }) : Promise.resolve([]),
      spawnCountOf(db, 'creature', entry),
    ]);
    return {
      rows: { creature_template: template, creature_template_model: models, creature_equip_template: equip, creature_loot_template: loot },
      sharedLoot: sharing.filter((r) => num(r.entry) !== entry).length, spawnCount,
    };
  }
  if (kind === 'object') {
    const template = await rowsOrNone(db, 'gameobject_template', { entry: key });
    if (template.length === 0) return null;
    const row = template[0]!;
    const type = num(row.type);
    const lootid = type === 3 ? num(row.Data1) : 0;
    const first = type === 9 ? num(row.Data0) : type === 10 ? num(row.Data7) : 0;
    const [loot, sharing, pages, spawnCount] = await Promise.all([
      lootid > 0 ? rowsOrNone(db, 'gameobject_loot_template', { Entry: str(lootid) }) : Promise.resolve([]),
      lootid > 0 ? rowsOrNone(db, 'gameobject_template', { type: '3', Data1: str(lootid) }) : Promise.resolve([]),
      pageRows(db, first),
      spawnCountOf(db, 'gameobject', entry),
    ]);
    return {
      rows: { gameobject_template: template, gameobject_loot_template: loot, page_text: pages },
      sharedLoot: sharing.filter((r) => num(r.entry) !== entry).length, spawnCount,
    };
  }
  const template = await rowsOrNone(db, 'item_template', { entry: key });
  if (template.length === 0) return null;
  return { rows: { item_template: template, page_text: await pageRows(db, num(template[0]!.PageText)) }, sharedLoot: 0, spawnCount: 0 };
}

const canonical = (rows: readonly RawRow[] | undefined): string[] =>
  (rows ?? []).map((r) => JSON.stringify(Object.fromEntries(Object.entries(r).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))))).sort();

/** Whether the database's rows for an edited existing entity differ from the ones it was read with */
export async function existingDrifted(db: WorldDb, entity: CustomNpc | CustomObject | CustomItem, kind: Kind): Promise<boolean> {
  if (entity.origin.kind !== 'existing') return false;
  const now = await readExistingRows(db, kind, entity.entry);
  if (!now) return true;
  const was = entity.origin.original;
  for (const table of new Set([...Object.keys(was), ...Object.keys(now.rows)])) {
    const a = canonical(was[table]);
    const b = canonical(now.rows[table]);
    if (a.length !== b.length || a.some((row, i) => row !== b[i])) return true;
  }
  return false;
}
