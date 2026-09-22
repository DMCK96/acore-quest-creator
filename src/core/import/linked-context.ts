import type { RawRow, SchemaInfo } from '../db/types';
import type { WorldDb } from '../db/world-db';
import type { FieldValue, Registry, RowSetValue, TableDef } from '../registry/types';

/**
 * The linked rows the quest does *not* own, for every creature or object it does.
 *
 * A linked table is fetched by item (`WHERE ItemId IN (...)`), so the snapshot holds only the rows
 * for this quest's items. Every other row of the same creature — another quest's quest-item row,
 * an ordinary non-quest drop — is invisible, which is how a new row could be allocated straight on
 * top of one and the patch would `DELETE` it without a word (spec §4.2, §12).
 *
 * These rows are read-only context. They are never edited, never written back and never compared
 * by the round-trip gate; they exist so the exporter can allocate a key that is actually free and
 * name the row it would otherwise have destroyed.
 */

const keyText = (def: TableDef, row: RawRow): string => JSON.stringify(def.keyColumns.map((c) => row[c] ?? null));

const linkedTablesWithEntry = (registry: Registry): TableDef[] =>
  registry.tables.filter((t) => t.role === 'linked' && t.entryColumn !== undefined);

/** Every entry value named by the quest's own rows and by the rows its model currently holds. */
function entriesOf(def: TableDef, rows: readonly RawRow[], model: RowSetValue | undefined): string[] {
  const entries = new Set<string>();
  const column = def.entryColumn as string;
  for (const row of rows) {
    const value = row[column];
    if (value !== null && value !== undefined && value !== '') entries.add(value);
  }
  for (const row of model ?? []) {
    const value = row[column];
    if (typeof value === 'number' && Number.isSafeInteger(value)) entries.add(String(value));
    else if (typeof value === 'string' && value !== '') entries.add(value);
  }
  return [...entries].sort();
}

export interface LinkedContextInput {
  db: WorldDb;
  registry: Registry;
  schema: SchemaInfo;
  /** The quest's own rows per table, as the snapshot holds them. */
  tables: Record<string, RawRow[]>;
  /** The aggregate's current field values, so entries the user has just added are covered too. */
  values?: Record<string, FieldValue>;
}

export async function fetchLinkedContext(input: LinkedContextInput): Promise<Record<string, RawRow[]>> {
  const { db, registry, schema, tables, values } = input;
  const context: Record<string, RawRow[]> = {};

  for (const def of linkedTablesWithEntry(registry)) {
    context[def.table] = [];
    if (!schema.tables[def.table]) continue;

    const own = tables[def.table] ?? [];
    const field = registry.fields.find((f) => f.table === def.table && f.shape === 'rowset');
    const model = field ? (values?.[field.id] as RowSetValue | undefined) : undefined;
    const entries = entriesOf(def, own, model);
    if (entries.length === 0) continue;

    const mine = new Set(own.map((row) => keyText(def, row)));
    const all = await db.selectRows(def.table, { [def.entryColumn as string]: entries });
    context[def.table] = all.filter((row) => !mine.has(keyText(def, row)));
  }

  return context;
}
