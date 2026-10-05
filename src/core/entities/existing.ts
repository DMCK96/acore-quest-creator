import { fightIsEmpty } from '../combat/model';
import type { RawRow, Where } from '../db/types';
import type { WorldDb } from '../db/world-db';
import type { PatchStatement } from '../export/build-patch';
import { ITEM_SLOT_BLOCKS, itemRow } from './item-columns';
import { itemFromRows, npcFromRows } from './from-rows';
import {
  existingOnly, NPC_TYPE_VALUE, OBJECT_TYPE_VALUE, RANK_VALUE,
  type CustomItem, type CustomNpc, type CustomObject, type LootRow, type OriginalRows, type Page, type ProjectEntities, type StoredOrigin,
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

/** Pages: the original chain's and the current chain's rows deleted, the current ones written over their original columns */
function writePages(out: Statements, origin: Existing, pages: readonly Page[]): void {
  const original = rowsOf(origin, 'page_text');
  const ids = [...new Set([...original.map((r) => num(r.ID)), ...pages.map((p) => p.id)])].filter((id) => id > 0).sort((a, b) => a - b);
  if (ids.length === 0) return;
  const byId = new Map(original.map((r) => [num(r.ID), r]));
  const rows = pages.map((page, i) => ({ ...byId.get(page.id), ID: text(page.id), Text: page.text, NextPageID: text(pages[i + 1]?.id ?? 0) }));
  writeTable(out, origin, 'page_text', ids.map((id) => ({ ID: text(id) })), rows);
}

function npcStatements(out: Statements, npc: CustomNpc, origin: Existing, givers: readonly number[]): void {
  const entry = text(npc.entry);
  const original: Row = rowsOf(origin, 'creature_template')[0] ?? { entry };
  const lootLocked = origin.locked.includes('loot');
  const fightLocked = origin.locked.includes('fight');
  const originalLoot = num(original.lootid);
  const lootId = originalLoot > 0 ? originalLoot : !lootLocked && npc.loot.length > 0 ? npc.entry : 0;
  const templateRow = (n: CustomNpc): Row => {
    const flags =
      (num(original.npcflag) & ~(GOSSIP_BIT | QUEST_GIVER_BIT)) |
      (n.questGiver || givers.includes(n.entry) ? QUEST_GIVER_BIT : 0) |
      (n.gossip ? GOSSIP_BIT : 0);
    return {
      ...original, entry, name: n.name, subname: n.subname, minlevel: text(n.minLevel), maxlevel: text(n.maxLevel),
      faction: text(n.faction), rank: text(RANK_VALUE[n.rank]), type: text(NPC_TYPE_VALUE[n.type]),
      HealthModifier: text(n.healthModifier), DamageModifier: text(n.damageModifier), npcflag: text(flags),
      AIName: !fightLocked && !fightIsEmpty(n.fight) ? 'SmartAI' : (original.AIName ?? ''),
      lootid: text(lootId),
    };
  };
  const asRead = npcFromRows(npc.entry, origin.original, { sharedLoot: origin.sharedLoot, spawnCount: origin.spawnCount });
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
}

function objectStatements(out: Statements, object: CustomObject, origin: Existing): void {
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
      lootId = originalLoot > 0 ? originalLoot : !origin.locked.includes('loot') && object.loot.length > 0 ? object.entry : 0;
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
export function existingStatements(store: ProjectEntities, givers: readonly number[]): Statements {
  const out: Statements = { apply: [], revert: [] };
  const edited = existingOnly(store);
  for (const npc of edited.npcs) if (npc.origin.kind === 'existing') npcStatements(out, npc, npc.origin, givers);
  for (const object of edited.objects) if (object.origin.kind === 'existing') objectStatements(out, object, object.origin);
  for (const item of edited.items) if (item.origin.kind === 'existing') itemStatements(out, item, item.origin);
  return out;
}

/** Where an existing entity's original rows live, so they can be read again and compared */
export function originalQueries(kind: 'npc' | 'object' | 'item', entry: number, original: OriginalRows): { table: string; where: Where; keep?: (row: Row) => boolean }[] {
  const id = text(entry);
  const first = (table: string): Row => original[table]?.[0] ?? {};
  const pages = (original.page_text ?? []).map((r) => text(num(r.ID)));
  const pageQuery = pages.length > 0 ? [{ table: 'page_text', where: { ID: pages } }] : [];
  if (kind === 'npc') {
    const lootId = num(first('creature_template').lootid);
    return [
      { table: 'creature_template', where: { entry: id } },
      { table: 'creature_template_model', where: { CreatureID: id }, keep: (r) => num(r.Idx) === 0 },
      { table: 'creature_equip_template', where: { CreatureID: id }, keep: (r) => num(r.ID) === 1 },
      ...(lootId > 0 ? [{ table: 'creature_loot_template', where: { Entry: text(lootId) } }] : []),
    ];
  }
  if (kind === 'object') {
    const template = first('gameobject_template');
    const lootId = num(template.type) === OBJECT_TYPE_VALUE.chest ? num(template.Data1) : 0;
    return [
      { table: 'gameobject_template', where: { entry: id } },
      ...(lootId > 0 ? [{ table: 'gameobject_loot_template', where: { Entry: text(lootId) } }] : []),
      ...pageQuery,
    ];
  }
  return [{ table: 'item_template', where: { entry: id } }, ...pageQuery];
}

/** Whether two lists hold the same rows, in any order, comparing values as text */
export function sameRows(a: readonly Row[], b: readonly RawRow[]): boolean {
  const norm = (row: Readonly<Row>): string => JSON.stringify(Object.keys(row).sort().map((k) => [k, row[k] ?? null]));
  const left = a.map(norm).sort();
  const right = b.map(norm).sort();
  return left.length === right.length && left.every((v, i) => v === right[i]);
}

/** The existing entities whose rows the database no longer has as they were when first edited */
export async function existingDrift(db: Pick<WorldDb, 'selectRows'>, store: ProjectEntities): Promise<{ kind: 'npc' | 'object' | 'item'; entry: number; name: string }[]> {
  const edited = existingOnly(store);
  const all = [
    ...edited.npcs.map((e) => ({ kind: 'npc' as const, entity: e })),
    ...edited.objects.map((e) => ({ kind: 'object' as const, entity: e })),
    ...edited.items.map((e) => ({ kind: 'item' as const, entity: e })),
  ];
  const drifted: { kind: 'npc' | 'object' | 'item'; entry: number; name: string }[] = [];
  for (const { kind, entity } of all) {
    if (entity.origin.kind !== 'existing') continue;
    const original = entity.origin.original;
    for (const query of originalQueries(kind, entity.entry, original)) {
      const kept = (rows: readonly Row[]): Row[] => rows.filter((r) => !query.keep || query.keep(r));
      if (!sameRows(kept(original[query.table] ?? []), kept(await db.selectRows(query.table, query.where)))) {
        drifted.push({ kind, entry: entity.entry, name: entity.name || String(entity.entry) });
        break;
      }
    }
  }
  return drifted;
}
