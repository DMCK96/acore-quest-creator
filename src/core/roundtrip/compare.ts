import type { RawRow, RawValue } from '../db/types';

export interface Difference {
  table: string;
  key: string;
  /** `null` means the whole row differs; `kind` then says which way. */
  column: string | null;
  before: RawValue | undefined;
  after: RawValue | undefined;
  /**
   * Only set on a whole-row difference (`column === null`): `'added'` when the row is only on the
   * "after" side, `'removed'` when it is only on the "before" side. A per-column difference leaves
   * it undefined, and so does a synthetic difference that stands for something other than a row.
   */
  kind?: 'added' | 'removed';
}

const keyText = (columns: readonly string[], row: RawRow): string =>
  columns.map((c) => `${c}=${row[c] === null || row[c] === undefined ? 'NULL' : row[c]}`).join(',');

function indexRows(columns: readonly string[], rows: readonly RawRow[]): Map<string, RawRow[]> {
  const index = new Map<string, RawRow[]>();
  for (const row of rows) {
    const key = keyText(columns, row);
    const bucket = index.get(key);
    if (bucket) bucket.push(row);
    else index.set(key, [row]);
  }
  return index;
}

const has = (row: RawRow, column: string): boolean => Object.prototype.hasOwnProperty.call(row, column);

/**
 * Strictly compares two sets of tables: `===` on the raw text, so `1` differs from `1.0` and NULL
 * from `''`. Rows are matched by key, never by position.
 */
export function compareTables(
  before: Record<string, RawRow[]>,
  after: Record<string, RawRow[]>,
  keys: Record<string, readonly string[]>,
): Difference[] {
  const differences: Difference[] = [];
  const tableNames = [...new Set([...Object.keys(before), ...Object.keys(after)])];

  for (const table of tableNames) {
    const columns = keys[table] ?? [];
    const left = indexRows(columns, before[table] ?? []);
    const right = indexRows(columns, after[table] ?? []);

    for (const [key, leftRows] of left) {
      const rightRows = right.get(key) ?? [];
      leftRows.forEach((leftRow, i) => {
        const rightRow = rightRows[i];
        if (rightRow === undefined) {
          differences.push({ table, key, column: null, before: undefined, after: undefined, kind: 'removed' });
          return;
        }
        for (const column of Object.keys(leftRow)) {
          if (!has(rightRow, column) || leftRow[column] !== rightRow[column]) {
            differences.push({ table, key, column, before: leftRow[column], after: rightRow[column] });
          }
        }
        for (const column of Object.keys(rightRow)) {
          if (!has(leftRow, column)) differences.push({ table, key, column, before: undefined, after: rightRow[column] });
        }
      });
    }
    for (const [key, rightRows] of right) {
      const extra = rightRows.length - (left.get(key)?.length ?? 0);
      for (let i = 0; i < extra; i++) {
        differences.push({ table, key, column: null, before: undefined, after: undefined, kind: 'added' });
      }
    }
  }
  return differences;
}
