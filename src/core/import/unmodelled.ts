import type { RawRow, RawValue, SchemaInfo } from '../db/types';
import type { Snapshot } from '../model/aggregate';
import type { Registry } from '../registry/types';
import { diffSchema } from '../schema/diff';

/** A database column no registry field claims, with the value it holds in each snapshot row. */
export interface UnmodelledColumn {
  table: string;
  column: string;
  values: { key: string; value: RawValue }[];
}

function rowKey(keyColumns: readonly string[], row: RawRow): string {
  return keyColumns.map((c) => `${c}=${row[c] ?? 'NULL'}`).join(',');
}

/**
 * Columns present in the database that the registry does not model. They are carried through the
 * snapshot untouched; this listing is what the UI shows so their existence is never a surprise.
 */
export function listUnmodelled(schema: SchemaInfo, registry: Registry, snapshot: Snapshot): UnmodelledColumn[] {
  const keyColumns = new Map(registry.tables.map((t) => [t.table, t.keyColumns]));
  const verbatim = new Set(registry.tables.filter((t) => t.role === 'verbatim').map((t) => t.table));
  const out: UnmodelledColumn[] = [];
  for (const { table, column } of diffSchema(schema, registry).unregistered) {
    if (verbatim.has(table)) continue; // preserved wholesale by design, not "unmodelled"
    const rows = snapshot.tables[table];
    if (!rows) continue;
    const keys = keyColumns.get(table) ?? [];
    out.push({
      table,
      column,
      values: rows.map((row) => ({ key: rowKey(keys, row), value: row[column] ?? null })),
    });
  }
  return out;
}
