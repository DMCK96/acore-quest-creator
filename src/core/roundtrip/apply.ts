import type { RawRow } from '../db/types';
import type { PatchStatement } from '../export/build-patch';
import type { Registry } from '../registry/types';

/** A patch that cannot be applied to the rows it was applied to (for instance a duplicate key). */
export class PatchApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PatchApplyError';
  }
}

/** Table -> the columns that identify one of its rows. */
export function keyColumnsByTable(registry: Registry): Record<string, readonly string[]> {
  const keys: Record<string, readonly string[]> = {};
  for (const def of registry.tables) keys[def.table] = def.keyColumns;
  return keys;
}

const matches = (row: RawRow, key: Readonly<Record<string, string>>): boolean =>
  Object.keys(key).every((column) => row[column] === key[column]);

/**
 * Applies a patch to a copy of the tables, the way the server would apply the rendered SQL.
 *
 * Pure: the input is never mutated. `set-flag` only touches a table that is present, so it never
 * adds one, and a NULL flag column stays NULL just as `NULL | 2` does in MySQL.
 */
export function applyPatchInMemory(
  tables: Record<string, RawRow[]>,
  statements: readonly PatchStatement[],
  keys: Record<string, readonly string[]>,
): Record<string, RawRow[]> {
  const out: Record<string, RawRow[]> = {};
  for (const [table, rows] of Object.entries(tables)) out[table] = rows.map((row) => ({ ...row }));

  for (const statement of statements) {
    switch (statement.kind) {
      case 'delete': {
        const rows = out[statement.table];
        if (rows) out[statement.table] = rows.filter((row) => !matches(row, statement.key));
        break;
      }
      case 'insert': {
        const rows = (out[statement.table] ??= []);
        const keyColumns = keys[statement.table] ?? [];
        if (keyColumns.length > 0 && rows.some((row) => keyColumns.every((c) => row[c] === statement.row[c]))) {
          const key = Object.fromEntries(keyColumns.map((c) => [c, statement.row[c]]));
          throw new PatchApplyError(`duplicate key in ${statement.table}: ${JSON.stringify(key)} already exists`);
        }
        rows.push({ ...statement.row });
        break;
      }
      case 'set-flag': {
        const rows = out[statement.table];
        if (!rows) break;
        out[statement.table] = rows.map((row) => {
          if (!matches(row, statement.key)) return row;
          const current = row[statement.column];
          if (current === null || current === undefined) return row;
          if (!/^\d+$/.test(current)) {
            throw new PatchApplyError(
              `cannot set a flag on ${statement.table}.${statement.column}: "${current}" is not an integer`,
            );
          }
          return { ...row, [statement.column]: (BigInt(current) | BigInt(statement.bit)).toString() };
        });
        break;
      }
    }
  }
  return out;
}
