import { defaultValueFor, type RawRow, type SchemaInfo } from '../db/types';
import type { WorldDb } from '../db/world-db';
import type { QuestAggregate, ReadOnlyReason, Snapshot } from '../model/aggregate';
import { CodecError, decodeList, decodeRowSetRow, decodeScalar } from '../registry/codec';
import { slotColumn } from '../registry/columns';
import type { FieldDef, FieldValue, ListValue, Registry, ScalarValue, TableDef } from '../registry/types';
import { diffSchema } from '../schema/diff';
import { fetchLinkedContext } from './linked-context';

/** The one table a quest cannot exist without. */
const QUEST_TABLE = 'quest_template';

export class InvalidQuestIdError extends Error {
  constructor(public readonly questId: number) {
    super(`Not a valid quest ID: ${questId}. A quest ID is a whole number above 0.`);
    this.name = 'InvalidQuestIdError';
  }
}

export class QuestNotFoundError extends Error {
  constructor(public readonly questId: number) {
    super(`Quest ${questId} does not exist in the world database.`);
    this.name = 'QuestNotFoundError';
  }
}

/** A fetched row whose columns do not match the schema: the snapshot could not be trusted. */
export class ImportIntegrityError extends Error {
  constructor(
    public readonly table: string,
    message: string,
  ) {
    super(message);
    this.name = 'ImportIntegrityError';
  }
}

/** A fresh row of nothing but column defaults: the caller supplies every identifying column. */
export function defaultColumnValues(table: string, schema: SchemaInfo): RawRow {
  const columns = schema.tables[table];
  if (!columns) throw new ImportIntegrityError(table, `Table ${table} is not in the loaded schema.`);
  const row: Record<string, string | null> = {};
  for (const c of columns) row[c.name] = defaultValueFor(c);
  return row;
}

/** The row a quest gets when a one-to-one table has none: every column's default, keyed by the quest. */
export function defaultRow(table: string, schema: SchemaInfo, keyColumn: string, questId: number): RawRow {
  return { ...defaultColumnValues(table, schema), [keyColumn]: String(questId) };
}

function checkRowColumns(table: string, columns: readonly string[], row: RawRow): void {
  const expected = new Set(columns);
  const actual = new Set(Object.keys(row));
  const missing = columns.filter((c) => !actual.has(c));
  const extra = [...actual].filter((c) => !expected.has(c));
  if (missing.length === 0 && extra.length === 0) return;
  const parts: string[] = [];
  if (missing.length > 0) parts.push(`missing ${missing.join(', ')}`);
  if (extra.length > 0) parts.push(`unexpected ${extra.join(', ')}`);
  throw new ImportIntegrityError(
    table,
    `Row fetched from ${table} does not match the schema: ${parts.join('; ')}.`,
  );
}

/** Field ids excluded from the aggregate because the database cannot back them. */
export function excludedFields(schema: SchemaInfo, registry: Registry): Set<string> {
  const diff = diffSchema(schema, registry);
  const excluded = new Set<string>();
  for (const m of diff.missingColumns) excluded.add(m.fieldId);
  for (const m of diff.typeMismatches) excluded.add(m.fieldId);
  const missingTables = new Set(diff.missingTables);
  for (const field of registry.fields) if (missingTables.has(field.table)) excluded.add(field.id);
  return excluded;
}

/**
 * The item IDs that make a quest's linked loot and quest-item rows findable.
 *
 * `0` is how the schema spells "no item", so it never joins the set; neither does a negative, which
 * no item ID ever is. Exported because the exporter asks the same question of the edited values.
 */
export function questItemIds(values: Record<string, FieldValue>, registry: Registry): number[] {
  const ids = new Set<number>();
  const add = (value: ScalarValue | undefined): void => {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) ids.add(value);
  };
  for (const field of registry.fields) {
    const value = values[field.id];
    if (value === undefined) continue;
    if (field.shape === 'scalar' && field.linksItems === true) add(value as ScalarValue);
    if (field.shape === 'list' && field.linksItems !== undefined) {
      for (const entry of value as ListValue) for (const member of field.linksItems) add(entry[member]);
    }
  }
  return [...ids].sort((a, b) => a - b);
}

/** The `quest_template` columns whose value is an item ID other quests may name too. */
function itemColumns(registry: Registry): string[] {
  const columns: string[] = [];
  for (const field of registry.fields) {
    if (field.table !== QUEST_TABLE) continue;
    if (field.shape === 'scalar' && field.linksItems === true) columns.push(field.column);
    if (field.shape === 'list' && field.linksItems !== undefined) {
      for (let n = 1; n <= field.slots; n++) {
        for (const member of field.members) {
          if (field.linksItems.includes(member.name)) columns.push(slotColumn(member.columnTemplate, n));
        }
      }
    }
  }
  return columns;
}

/**
 * Item ID -> the other quests that require it.
 *
 * Linked rows are shared, so the editor has to be able to say whose toes an edit steps on. One
 * query per item column keeps this to a handful of indexed lookups.
 */
async function findSharedItems(
  db: WorldDb,
  schema: SchemaInfo,
  registry: Registry,
  questId: number,
  itemIds: readonly number[],
): Promise<Record<string, number[]>> {
  if (itemIds.length === 0) return {};
  const present = new Set((schema.tables[QUEST_TABLE] ?? []).map((c) => c.name));
  const wanted = itemIds.map(String);

  const byItem = new Map<string, Set<number>>();
  for (const column of itemColumns(registry)) {
    if (!present.has(column)) continue;
    for (const row of await db.selectRows(QUEST_TABLE, { [column]: wanted })) {
      const item = row[column];
      const other = Number(row.ID);
      if (item === null || !Number.isSafeInteger(other) || other === questId) continue;
      const quests = byItem.get(item) ?? new Set<number>();
      quests.add(other);
      byItem.set(item, quests);
    }
  }

  const out: Record<string, number[]> = {};
  for (const [item, quests] of [...byItem].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    if (quests.size > 0) out[item] = [...quests].sort((a, b) => a - b);
  }
  return out;
}

export async function importQuest(
  db: WorldDb,
  schema: SchemaInfo,
  registry: Registry,
  questId: number,
): Promise<{ aggregate: QuestAggregate; snapshot: Snapshot }> {
  if (!Number.isSafeInteger(questId) || questId <= 0) throw new InvalidQuestIdError(questId);

  const excluded = excludedFields(schema, registry);
  const tables: Record<string, RawRow[]> = {};
  const columnsRead: Record<string, string[]> = {};

  const fetch = async (def: TableDef, itemIds: readonly number[]): Promise<void> => {
    const columns = schema.tables[def.table];
    columnsRead[def.table] = columns ? columns.map((c) => c.name) : [];
    // A linked table is reached only through items: with none there is nothing to ask for.
    if (!columns || (def.role === 'linked' && itemIds.length === 0)) {
      tables[def.table] = [];
      return;
    }
    const rows = await db.selectRows(def.table, def.where(questId, itemIds));
    for (const row of rows) checkRowColumns(def.table, columnsRead[def.table], row);
    tables[def.table] = rows;
  };

  const values: Record<string, FieldValue> = {};
  const readOnly: ReadOnlyReason[] = [];
  const decodeTable = (def: TableDef): void => {
    if (!schema.tables[def.table]) return;
    const fields = registry.fields.filter((f) => f.table === def.table && !excluded.has(f.id));
    if (def.cardinality === 'one') {
      const row = tables[def.table][0] ?? defaultRow(def.table, schema, def.keyColumns[0], questId);
      for (const field of fields) decodeOne(field, row, values, readOnly);
    } else {
      for (const field of fields) decodeMany(field, tables[def.table], values, readOnly);
    }
  };

  // Owned and verbatim rows are keyed by the quest, so they can all be read straight away.
  const byQuest = registry.tables.filter((t) => t.role !== 'linked');
  for (const def of byQuest) await fetch(def, []);
  if ((tables[QUEST_TABLE] ?? []).length === 0) throw new QuestNotFoundError(questId);
  for (const def of byQuest) decodeTable(def);

  // Only now are the quest's items known, and with them which linked rows belong to it.
  const itemIds = questItemIds(values, registry);
  const linked = registry.tables.filter((t) => t.role === 'linked');
  for (const def of linked) await fetch(def, itemIds);
  for (const def of linked) decodeTable(def);

  // The rows the quest does not own but shares a creature or object with: read last, so the
  // exporter can see the keys its own `where` clause hid from it.
  const linkedContext = await fetchLinkedContext({ db, registry, schema, tables, values });
  const snapshot: Snapshot = { questId, tables, columnsRead, linkedContext, schemaHash: schema.hash };
  const sharedItems = await findSharedItems(db, schema, registry, questId, itemIds);
  const aggregate: QuestAggregate = { questId, isNew: false, values, readOnly, sharedItems };
  return { aggregate, snapshot };
}

function record(
  field: FieldDef,
  values: Record<string, FieldValue>,
  readOnly: ReadOnlyReason[],
  decode: () => FieldValue,
): void {
  try {
    values[field.id] = decode();
  } catch (error) {
    if (!(error instanceof CodecError)) throw error;
    readOnly.push({ fieldId: field.id, reason: error.message });
  }
}

function shapeError(field: FieldDef, cardinality: TableDef['cardinality']): Error {
  return new Error(
    `Registry error: ${field.id} is a ${field.shape} field on the ${cardinality}-row table ${field.table}.`,
  );
}

/** One row per quest: scalar and list fields read the single row. */
function decodeOne(
  field: FieldDef,
  row: RawRow,
  values: Record<string, FieldValue>,
  readOnly: ReadOnlyReason[],
): void {
  if (field.shape === 'rowset') throw shapeError(field, 'one');
  if (field.shape === 'scalar') {
    record(field, values, readOnly, () => decodeScalar(field.type, row[field.column] ?? null));
  } else {
    record(field, values, readOnly, () => decodeList(field, row));
  }
}

/** Many rows per quest: one rowset field holds them all. */
function decodeMany(
  field: FieldDef,
  rows: readonly RawRow[],
  values: Record<string, FieldValue>,
  readOnly: ReadOnlyReason[],
): void {
  if (field.shape !== 'rowset') throw shapeError(field, 'many');
  record(field, values, readOnly, () => rows.map((row) => decodeRowSetRow(field, row)));
}
