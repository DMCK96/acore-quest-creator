import { fightIsEmpty } from '../combat/model';
import type { RawRow } from '../db/types';
import type { WorldDb } from '../db/world-db';
import type { PatchStatement } from '../export/build-patch';
import { ITEM_SLOT_BLOCKS, itemRow } from './item-columns';
import { itemFromRows, npcFromRows } from './from-rows';
import { seenByColumns, seenByOf } from './visibility';
import { npcSpawnGuids, spawnEventRows } from './spawn-events-read';
import { rowsOrNone } from '../db/rows-or-none';
import {
  existingOnly, sameVendor, vendorUnread, NPC_TYPE_VALUE, OBJECT_TYPE_VALUE, RANK_VALUE,
  type CustomItem, type CustomNpc, type CustomObject, type LootRow, type OriginalRows, type Page, type ProjectEntities, type StoredOrigin, type VendorItem,
} from './model';

/**
 * The patch rows of existing NPCs, objects and items edited in the project. Each table is written as
 * the row the database had with the editor's modelled columns laid over it, so every column, flag
 * bit and script name the editor does not know stays as it was; the revert deletes the same keys and
 * puts the original rows back.
 */

type Row = Record<string, string | null>;
type Existing = Extract<StoredOrigin, { kind: 'existing' }>;
type Statements = { apply: PatchStatement[]; revert: PatchStatement[] };

const GOSSIP_BIT = 1;
const QUEST_GIVER_BIT = 2;
const VENDOR_BIT = 128;
const DATA_COLUMN = /^Data\d+$/;

const text = (n: number): string => String(n);
const num = (raw: string | null | undefined): number => {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const rowsOf = (origin: Existing, table: string): Row[] => origin.original[table] ?? [];
const matches = (row: Row, key: Record<string, string>): boolean => Object.entries(key).every(([c, v]) => num(row[c]) === num(v));

const has = (row: Row, column: string): boolean => Object.prototype.hasOwnProperty.call(row, column);

/**
 * Puts back the database's own value of every column the editor left as it read it. `asRead` is the row
 * the editor would write for the entity exactly as it was read, so a column whose written value equals it
 * was not edited: its raw value (a creature type the editor has no name for, a blank, a zero stat) stays.
 * Each block in `blocks` is kept or written as a whole; `derived` columns (set from more than the editor's
 * fields, such as the quest giver bit a project quest gives) are always written.
 */
function keepUnedited(row: Row, asRead: Row, original: Row, blocks: readonly (readonly string[])[] = [], derived: readonly string[] = []): Row {
  const out: Row = { ...row };
  const inBlock = new Set(blocks.flat());
  for (const column of Object.keys(row)) {
    if (!inBlock.has(column) && !derived.includes(column) && has(original, column) && row[column] === asRead[column]) out[column] = original[column]!;
  }
  for (const block of blocks) {
    if (block.every((column) => row[column] === asRead[column])) for (const column of block) if (has(original, column)) out[column] = original[column]!;
  }
  return out;
}

/** Writes one table: deletes each key, inserts the rows; the revert deletes the same keys and inserts the originals under them */
function writeTable(out: Statements, origin: Existing, table: string, keys: Record<string, string>[], rows: Row[]): void {
  for (const key of keys) {
    out.apply.push({ kind: 'delete', table, key });
    out.revert.push({ kind: 'delete', table, key });
  }
  for (const row of rows) out.apply.push({ kind: 'insert', table, row: row as RawRow });
  for (const row of rowsOf(origin, table)) {
    if (keys.some((key) => matches(row, key))) out.revert.push({ kind: 'insert', table, row: row as RawRow });
  }
}

const lootRows = (lootId: number, loot: readonly LootRow[]): Row[] =>
  loot.map((row) => ({
    Entry: text(lootId), Item: text(row.item), Reference: '0', Chance: text(row.chance), QuestRequired: row.questOnly ? '1' : '0',
    LootMode: '1', GroupId: '0', MinCount: text(row.min), MaxCount: text(row.max), Comment: '',
  }));

/** The stock rows, slot by position; a row for an item and cost the database already had keeps its other columns (`VerifiedBuild`) */
const vendorRows = (entry: string, vendor: readonly VendorItem[], original: readonly Row[]): Row[] =>
  vendor.map((v, slot) => {
    const same = original.find((r) => num(r.item) === v.item && num(r.ExtendedCost) === v.extendedCost);
    return {
      ...same, entry, slot: text(slot), item: text(v.item), maxcount: text(v.maxCount),
      // Unlimited stock never restocks
      incrtime: text(v.maxCount === 0 ? 0 : v.restockSecs), ExtendedCost: text(v.extendedCost),
    };
  });

/** Pages: the original chain's and the current chain's rows deleted, the current ones written over their original columns */
function writePages(out: Statements, origin: Existing, pages: readonly Page[]): void {
  const original = rowsOf(origin, 'page_text');
  const ids = [...new Set([...original.map((r) => num(r.ID)), ...pages.map((p) => p.id)])].filter((id) => id > 0).sort((a, b) => a - b);
  if (ids.length === 0) return;
  const byId = new Map(original.map((r) => [num(r.ID), r]));
  const rows = pages.map((page, i) => ({ ...byId.get(page.id), ID: text(page.id), Text: page.text, NextPageID: text(pages[i + 1]?.id ?? 0) }));
  writeTable(out, origin, 'page_text', ids.map((id) => ({ ID: text(id) })), rows);
}

/** A free loot id given to an existing NPC or chest whose entry is already another loot list, by 'npc:<entry>' or 'object:<entry>' */
export type LootIds = ReadonlyMap<string, number>;

/** Whether an existing NPC or chest has no loot list of its own yet and is given one, under a new loot id */
function wantsNewLoot(kind: 'npc' | 'object', entity: CustomNpc | CustomObject): boolean {
  if (entity.origin.kind !== 'existing' || entity.origin.locked.includes('loot') || entity.loot.length === 0) return false;
  if (kind === 'npc') return num(rowsOf(entity.origin, 'creature_template')[0]?.lootid) === 0;
  const object = entity as CustomObject;
  if (entity.origin.locked.includes('type') || object.type !== 'chest') return false;
  const original = rowsOf(entity.origin, 'gameobject_template')[0] ?? {};
  return num(original.type) !== OBJECT_TYPE_VALUE.chest || num(original.Data1) === 0;
}

const LOOT_TABLE = { npc: 'creature_loot_template', object: 'gameobject_loot_template' } as const;

/**
 * The loot ids existing NPCs and chests get when they are given their first loot. Their entry is used
 * unless some other loot list already has that id (a list the database's own row of this entity does not
 * point at, so not one an earlier apply of this patch wrote); then the next free id is taken, so the patch
 * never writes over another list and its revert never deletes it.
 */
export async function newLootIds(
  db: Pick<WorldDb, 'selectRows'> & Partial<Pick<WorldDb, 'selectMax'>>, store: ProjectEntities,
): Promise<{ ids: Map<string, number>; warnings: string[] }> {
  const ids = new Map<string, number>();
  const warnings: string[] = [];
  const taken: Record<'npc' | 'object', Set<number>> = { npc: new Set(), object: new Set() };
  const edited = existingOnly(store);
  const wanting = [
    ...edited.npcs.filter((e) => wantsNewLoot('npc', e)).map((entity) => ({ kind: 'npc' as const, entity })),
    ...edited.objects.filter((e) => wantsNewLoot('object', e)).map((entity) => ({ kind: 'object' as const, entity })),
  ];
  for (const { kind, entity } of wanting) {
    const table = LOOT_TABLE[kind];
    const id = text(entity.entry);
    const rows = await db.selectRows(table, { Entry: id });
    if (rows.length === 0) continue;
    const own = kind === 'npc'
      ? (await db.selectRows('creature_template', { entry: id })).some((r) => num(r.lootid) === entity.entry)
      : (await db.selectRows('gameobject_template', { entry: id })).some((r) => num(r.type) === OBJECT_TYPE_VALUE.chest && num(r.Data1) === entity.entry);
    if (own) continue;
    let next = Math.max(entity.entry, ...taken[kind]) + 1;
    const max = db.selectMax ? await db.selectMax(table, 'Entry') : null;
    if (max !== null) next = Math.max(next, max + 1);
    while (taken[kind].has(next) || (max === null && (await db.selectRows(table, { Entry: text(next) })).length > 0)) next += 1;
    taken[kind].add(next);
    ids.set(`${kind}:${entity.entry}`, next);
    warnings.push(`"${entity.name || entity.entry}" gets loot id ${next}: loot list ${entity.entry} already belongs to something else.`);
  }
  return { ids, warnings };
}

function npcStatements(out: Statements, npc: CustomNpc, origin: Existing, givers: readonly number[], lootIds: LootIds): void {
  const entry = text(npc.entry);
  const original: Row = rowsOf(origin, 'creature_template')[0] ?? { entry };
  const lootLocked = origin.locked.includes('loot');
  const fightLocked = origin.locked.includes('fight');
  const originalLoot = num(original.lootid);
  const lootId = originalLoot > 0 ? originalLoot : !lootLocked && npc.loot.length > 0 ? (lootIds.get(`npc:${npc.entry}`) ?? npc.entry) : 0;
  const asRead = npcFromRows(npc.entry, origin.original, { sharedLoot: origin.sharedLoot, spawnCount: origin.spawnCount });
  // Stock a project saved before vendors existed never read is not ours to replace; stock left as read is not written
  const vendorChanged = !vendorUnread(npc) && !sameVendor(npc.vendor, asRead.vendor);
  const vendorBit = vendorChanged ? (npc.vendor.length > 0 ? VENDOR_BIT : 0) : num(original.npcflag) & VENDOR_BIT;
  const templateRow = (n: CustomNpc): Row => {
    const flags =
      (num(original.npcflag) & ~(GOSSIP_BIT | QUEST_GIVER_BIT | VENDOR_BIT)) |
      (n.questGiver || givers.includes(n.entry) ? QUEST_GIVER_BIT : 0) |
      (n.gossip ? GOSSIP_BIT : 0) |
      vendorBit;
    return {
      ...original, entry, name: n.name, subname: n.subname, minlevel: text(n.minLevel), maxlevel: text(n.maxLevel),
      faction: text(n.faction), rank: text(RANK_VALUE[n.rank]), type: text(NPC_TYPE_VALUE[n.type]),
      HealthModifier: text(n.healthModifier), DamageModifier: text(n.damageModifier), npcflag: text(flags),
      AIName: !fightLocked && !fightIsEmpty(n.fight) ? 'SmartAI' : (original.AIName ?? ''),
      lootid: text(lootId),
      // Written only when changed: absent on an NPC saved before it could be set, its flags stay as they are
      ...(n.seenBy && n.seenBy !== seenByOf(original) ? seenByColumns(n.seenBy, original) : {}),
    };
  };
  writeTable(out, origin, 'creature_template', [{ entry }], [keepUnedited(templateRow(npc), templateRow(asRead), original, [], ['npcflag', 'lootid', 'AIName'])]);

  const model = rowsOf(origin, 'creature_template_model').find((r) => num(r.Idx) === 0) ?? { CreatureID: entry, Idx: '0', Probability: '1' };
  writeTable(out, origin, 'creature_template_model', [{ CreatureID: entry, Idx: '0' }], [
    { ...model, CreatureDisplayID: text(npc.displayId), DisplayScale: text(npc.scale) },
  ]);

  const { mainHand, offHand, ranged } = npc.equipment;
  const gear = rowsOf(origin, 'creature_equip_template').find((r) => num(r.ID) === 1);
  const armed = mainHand > 0 || offHand > 0 || ranged > 0;
  if (armed || gear) {
    writeTable(out, origin, 'creature_equip_template', [{ CreatureID: entry, ID: '1' }], armed
      ? [{ ...(gear ?? { CreatureID: entry, ID: '1' }), ItemID1: text(mainHand), ItemID2: text(offHand), ItemID3: text(ranged) }]
      : []);
  }

  if (!lootLocked && lootId > 0) writeTable(out, origin, 'creature_loot_template', [{ Entry: text(lootId) }], lootRows(lootId, npc.loot));
  if (vendorChanged) writeTable(out, origin, 'npc_vendor', [{ entry }], vendorRows(entry, npc.vendor, rowsOf(origin, 'npc_vendor')));
}

function objectStatements(out: Statements, object: CustomObject, origin: Existing, lootIds: LootIds): void {
  const entry = text(object.entry);
  const original: Row = rowsOf(origin, 'gameobject_template')[0] ?? { entry };
  const row: Row = { ...original, entry, name: object.name, displayId: text(object.displayId), size: text(object.size) };
  let lootId = 0;
  if (!origin.locked.includes('type')) {
    const type = OBJECT_TYPE_VALUE[object.type];
    // A new type gives the Data columns new meanings: the old type's values go
    if (num(original.type) !== type) for (const column of Object.keys(row)) if (DATA_COLUMN.test(column)) row[column] = '0';
    row.type = text(type);
    const firstPage = text(object.pages[0]?.id ?? 0);
    const quest = text(object.onlyDuringQuest ?? 0);
    if (object.type === 'text') row.Data0 = firstPage;
    if (object.type === 'goober') Object.assign(row, { Data1: quest, Data7: firstPage });
    if (object.type === 'chest') {
      // A chest's loot stays under the list it has; one with none gets its own entry when loot is added
      const originalLoot = num(row.Data1);
      lootId = originalLoot > 0 ? originalLoot : !origin.locked.includes('loot') && object.loot.length > 0 ? (lootIds.get(`object:${object.entry}`) ?? object.entry) : 0;
      Object.assign(row, { Data1: text(lootId), Data8: quest });
    }
  }
  writeTable(out, origin, 'gameobject_template', [{ entry }], [row]);
  if (!origin.locked.includes('loot') && lootId > 0) writeTable(out, origin, 'gameobject_loot_template', [{ Entry: text(lootId) }], lootRows(lootId, object.loot));
  writePages(out, origin, object.pages);
}

function itemStatements(out: Statements, item: CustomItem, origin: Existing): void {
  const original: Row = rowsOf(origin, 'item_template')[0] ?? {};
  const asRead = itemFromRows(item.entry, origin.original);
  const row = keepUnedited({ ...original, ...itemRow(item) }, { ...original, ...itemRow(asRead) }, original, ITEM_SLOT_BLOCKS);
  writeTable(out, origin, 'item_template', [{ entry: text(item.entry) }], [row]);
  writePages(out, origin, item.pages);
}

/** The apply and revert rows of every existing entity in the store; new ones are compiled elsewhere */
export function existingStatements(store: ProjectEntities, givers: readonly number[], lootIds: LootIds = new Map()): Statements {
  const out: Statements = { apply: [], revert: [] };
  const edited = existingOnly(store);
  for (const npc of edited.npcs) if (npc.origin.kind === 'existing') npcStatements(out, npc, npc.origin, givers, lootIds);
  for (const object of edited.objects) if (object.origin.kind === 'existing') objectStatements(out, object, object.origin, lootIds);
  for (const item of edited.items) if (item.origin.kind === 'existing') itemStatements(out, item, item.origin);
  return out;
}

type Kind = 'npc' | 'object' | 'item';
type RowReader = Pick<WorldDb, 'selectRows'> & Partial<Pick<WorldDb, 'columns'>>;


/** The rows of a page chain starting at `first`, following `NextPageID` */
async function pageRows(db: RowReader, first: number): Promise<Row[]> {
  const rows: Row[] = [];
  const seen = new Set<number>();
  for (let id = first; id > 0 && !seen.has(id); ) {
    seen.add(id);
    const [row] = await rowsOrNone(db, 'page_text', { ID: text(id) });
    if (!row) break;
    rows.push(row);
    id = num(row.NextPageID);
  }
  return rows;
}

/**
 * The rows an existing NPC, object or item is made of, as the database has them now; null when it has
 * none. What is brought into the project is kept as these rows, and drift compares against them again.
 */
export async function readOriginalRows(db: RowReader, kind: Kind, entry: number): Promise<OriginalRows | null> {
  const key = text(entry);
  if (kind === 'npc') {
    const template = await rowsOrNone(db, 'creature_template', { entry: key });
    if (template.length === 0) return null;
    const lootid = num(template[0]!.lootid);
    const [models, equip, loot, vendor, hasVendorTable] = await Promise.all([
      rowsOrNone(db, 'creature_template_model', { CreatureID: key }),
      rowsOrNone(db, 'creature_equip_template', { CreatureID: key, ID: '1' }),
      lootid > 0 ? rowsOrNone(db, 'creature_loot_template', { Entry: text(lootid) }) : Promise.resolve([]),
      rowsOrNone(db, 'npc_vendor', { entry: key }),
      // A fork without the table has no stock to read; the key is left out so its stock is never written
      db.columns ? db.columns('npc_vendor').then((columns) => columns.length > 0) : Promise.resolve(true),
    ]);
    // Its spawns and their game event rows: what its event rule is read from
    const guids = await npcSpawnGuids(db, entry);
    const events = [...(await spawnEventRows(db, guids)).values()].flat()
      .sort((a, b) => num(a.guid) - num(b.guid) || num(a.eventEntry) - num(b.eventEntry));
    return {
      creature_template: template, creature_template_model: models, creature_equip_template: equip, creature_loot_template: loot, ...(hasVendorTable ? { npc_vendor: vendor } : {}),
      creature: guids.map((g) => ({ guid: text(g) })), game_event_creature: events,
    };
  }
  if (kind === 'object') {
    const template = await rowsOrNone(db, 'gameobject_template', { entry: key });
    if (template.length === 0) return null;
    const row = template[0]!;
    const type = num(row.type);
    const lootid = type === OBJECT_TYPE_VALUE.chest ? num(row.Data1) : 0;
    const first = type === OBJECT_TYPE_VALUE.text ? num(row.Data0) : type === OBJECT_TYPE_VALUE.goober ? num(row.Data7) : 0;
    const [loot, pages] = await Promise.all([
      lootid > 0 ? rowsOrNone(db, 'gameobject_loot_template', { Entry: text(lootid) }) : Promise.resolve([]),
      pageRows(db, first),
    ]);
    return { gameobject_template: template, gameobject_loot_template: loot, page_text: pages };
  }
  const template = await rowsOrNone(db, 'item_template', { entry: key });
  if (template.length === 0) return null;
  return { item_template: template, page_text: await pageRows(db, num(template[0]!.PageText)) };
}

/** Whether two lists hold the same rows, in any order, comparing values as text */
export function sameRows(a: readonly Row[], b: readonly RawRow[]): boolean {
  const norm = (row: Readonly<Row>): string => JSON.stringify(Object.keys(row).sort().map((k) => [k, row[k] ?? null]));
  const left = a.map(norm).sort();
  const right = b.map(norm).sort();
  return left.length === right.length && left.every((v, i) => v === right[i]);
}

/**
 * The existing entities whose rows the database no longer has as they were when first brought in: the
 * rows are read again as `readOriginalRows` read them and compared table by table. The Project changes
 * badge and the export's warning both come from here, so they always agree.
 */
/**
 * A table's rows then and now, as drift compares them. Spawns coming and going are not the NPC's rows
 * (the patch does not write them), so the spawn list is not compared, and spawn events only for the
 * spawns both lists have.
 */
function comparable(table: string, was: OriginalRows, now: OriginalRows): [Row[], Row[]] {
  if (table === 'creature') return [[], []];
  if (table !== 'game_event_creature') return [was[table] ?? [], (now[table] ?? []) as Row[]];
  const guidsOf = (rows: OriginalRows) => new Set((rows.creature ?? []).map((r) => r.guid));
  const before = guidsOf(was);
  const after = guidsOf(now);
  const both = (rows: Row[]) => rows.filter((r) => before.has(r.guid ?? null) && after.has(r.guid ?? null));
  return [both(was[table] ?? []), both((now[table] ?? []) as Row[])];
}

export async function existingDrift(db: RowReader, store: ProjectEntities): Promise<{ kind: Kind; entry: number; name: string }[]> {
  const edited = existingOnly(store);
  const all = [
    ...edited.npcs.map((e) => ({ kind: 'npc' as const, entity: e })),
    ...edited.objects.map((e) => ({ kind: 'object' as const, entity: e })),
    ...edited.items.map((e) => ({ kind: 'item' as const, entity: e })),
  ];
  const drifted: { kind: Kind; entry: number; name: string }[] = [];
  for (const { kind, entity } of all) {
    if (entity.origin.kind !== 'existing') continue;
    const was = entity.origin.original;
    const now = await readOriginalRows(db, kind, entity.entry);
    // A project saved before a table was read has none of it, which is not a change
    const changed = !now || Object.keys(was).some((table) => !sameRows(...comparable(table, was, now)));
    if (changed) drifted.push({ kind, entry: entity.entry, name: entity.name || String(entity.entry) });
  }
  return drifted;
}
