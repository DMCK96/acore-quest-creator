import { defaultValueFor, type RawRow, type SchemaInfo } from '../db/types';
import type { WorldDb } from '../db/world-db';
import type { QuestAggregate, ReadOnlyReason, Snapshot } from '../model/aggregate';
import { CodecError, decodeList, decodeRowSetRow, decodeScalar } from '../registry/codec';
import type { FieldDef, FieldValue, Registry, TableDef } from '../registry/types';
import { diffSchema } from '../schema/diff';

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

/** The row a quest gets when a one-to-one table has none: every column's default, keyed by the quest. */
export function defaultRow(table: string, schema: SchemaInfo, keyColumn: string, questId: number): RawRow {
  const columns = schema.tables[table];
  if (!columns) throw new ImportIntegrityError(table, `Table ${table} is not in the loaded schema.`);
  const row: Record<string, string | null> = {};
  for (const c of columns) row[c.name] = defaultValueFor(c);
  row[keyColumn] = String(questId);
  return row;
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
function excludedFields(schema: SchemaInfo, registry: Registry): Set<string> {
  const diff = diffSchema(schema, registry);
  const excluded = new Set<string>();
  for (const m of diff.missingColumns) excluded.add(m.fieldId);
  for (const m of diff.typeMismatches) excluded.add(m.fieldId);
  const missingTables = new Set(diff.missingTables);
  for (const field of registry.fields) if (missingTables.has(field.table)) excluded.add(field.id);
  return excluded;
}

/** Tables the importer reads by quest ID. Linked tables are found by item and arrive in Task 15. */
function snapshotTables(registry: Registry): TableDef[] {
  return registry.tables.filter((t) => t.role === 'owned' || t.role === 'verbatim');
}

export async function importQuest(
  db: WorldDb,
  schema: SchemaInfo,
  registry: Registry,
  questId: number,
): Promise<{ aggregate: QuestAggregate; snapshot: Snapshot }> {
  if (!Number.isSafeInteger(questId) || questId <= 0) throw new InvalidQuestIdError(questId);

  const excluded = excludedFields(schema, registry);
  const defs = snapshotTables(registry);

  const tables: Record<string, RawRow[]> = {};
  const columnsRead: Record<string, string[]> = {};
  for (const def of defs) {
    const columns = schema.tables[def.table];
    columnsRead[def.table] = columns ? columns.map((c) => c.name) : [];
    if (!columns) {
      tables[def.table] = [];
      continue;
    }
    const rows = await db.selectRows(def.table, def.where(questId, []));
    for (const row of rows) checkRowColumns(def.table, columnsRead[def.table], row);
    tables[def.table] = rows;
  }

  if ((tables[QUEST_TABLE] ?? []).length === 0) throw new QuestNotFoundError(questId);

  const snapshot: Snapshot = { questId, tables, columnsRead, schemaHash: schema.hash };

  const values: Record<string, FieldValue> = {};
  const readOnly: ReadOnlyReason[] = [];
  for (const def of defs) {
    if (!schema.tables[def.table]) continue;
    const fields = registry.fields.filter((f) => f.table === def.table && !excluded.has(f.id));
    if (def.cardinality === 'one') {
      const row = tables[def.table][0] ?? defaultRow(def.table, schema, def.keyColumns[0], questId);
      for (const field of fields) decodeOne(field, row, values, readOnly);
    } else {
      for (const field of fields) decodeMany(field, tables[def.table], values, readOnly);
    }
  }

  const aggregate: QuestAggregate = { questId, isNew: false, values, readOnly, sharedItems: {} };
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
