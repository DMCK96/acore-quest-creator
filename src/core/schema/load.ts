import { createHash } from 'node:crypto';
import type { SchemaInfo } from '../db/types';
import type { WorldDb } from '../db/world-db';

/**
 * Reads the column metadata of `tables`. Tables that do not exist in the database
 * are omitted. The hash covers every `table.column:columnType`, sorted, so it changes
 * whenever a column is added, removed or retyped.
 *
 * `INFORMATION_SCHEMA` hides a table the querying user has no privilege on, so an empty column
 * list is ambiguous: each one is probed (where the driver can) to say whether it is absent from
 * this fork or merely forbidden. The hash deliberately ignores `forbidden` — it describes the
 * shape of what was read, and a grant change does not change that shape.
 */
export async function loadSchema(db: WorldDb, tables: readonly string[]): Promise<SchemaInfo> {
  const result: SchemaInfo['tables'] = {};
  const forbidden: string[] = [];
  for (const table of tables) {
    const columns = await db.columns(table);
    if (columns.length > 0) {
      result[table] = columns;
      continue;
    }
    if (db.probeMissingTable && (await db.probeMissingTable(table)) === 'forbidden') forbidden.push(table);
  }
  const lines: string[] = [];
  for (const [table, columns] of Object.entries(result)) {
    for (const c of columns) lines.push(`${table}.${c.name}:${c.columnType}`);
  }
  lines.sort();
  return {
    tables: result,
    forbidden: forbidden.sort(),
    hash: createHash('sha256').update(lines.join('\n')).digest('hex'),
  };
}
