import { createHash } from 'node:crypto';
import type { SchemaInfo } from '../db/types';
import type { WorldDb } from '../db/world-db';

/**
 * Reads the column metadata of `tables`. Tables that do not exist in the database
 * are omitted. The hash covers every `table.column:columnType`, sorted, so it changes
 * whenever a column is added, removed or retyped.
 */
export async function loadSchema(db: WorldDb, tables: readonly string[]): Promise<SchemaInfo> {
  const result: SchemaInfo['tables'] = {};
  for (const table of tables) {
    const columns = await db.columns(table);
    if (columns.length > 0) result[table] = columns;
  }
  const lines: string[] = [];
  for (const [table, columns] of Object.entries(result)) {
    for (const c of columns) lines.push(`${table}.${c.name}:${c.columnType}`);
  }
  lines.sort();
  return { tables: result, hash: createHash('sha256').update(lines.join('\n')).digest('hex') };
}
