import type { ColumnInfo, RawRow, RawValue } from '@core/db/types';
import { isNumericColumn } from '@core/db/types';

export class SqlRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SqlRenderError';
  }
}

const ESCAPES: Readonly<Record<string, string>> = {
  '\\': '\\\\',
  "'": "\\'",
  '\0': '\\0',
  '\x1a': '\\Z',
};

/** Single-quoted MySQL string literal. Only backslash, quote, NUL and Ctrl-Z are escaped; everything else is verbatim. */
export function quoteString(s: string): string {
  return `'${s.replace(/[\\'\0\x1a]/g, (c) => ESCAPES[c] as string)}'`;
}

const NUMERIC_TEXT = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;

export function renderValue(col: ColumnInfo, value: RawValue): string {
  if (value === null) {
    if (col.nullable) return 'NULL';
    throw new SqlRenderError(`Column \`${col.name}\` is NOT NULL but got NULL`);
  }
  if (isNumericColumn(col)) {
    if (!NUMERIC_TEXT.test(value)) {
      throw new SqlRenderError(`Column \`${col.name}\` is numeric but got non-numeric text ${JSON.stringify(value)}`);
    }
    return value;
  }
  return quoteString(value);
}

const ident = (name: string): string => `\`${name.replace(/`/g, '``')}\``;

export function renderInsert(table: string, columns: readonly ColumnInfo[], row: RawRow): string {
  const ordered = [...columns].sort((a, b) => a.ordinal - b.ordinal);
  const known = new Set(ordered.map((c) => c.name));
  for (const key of Object.keys(row)) {
    if (!known.has(key)) throw new SqlRenderError(`Row for \`${table}\` has unknown column \`${key}\``);
  }
  const values = ordered.map((c) => {
    if (!Object.prototype.hasOwnProperty.call(row, c.name)) {
      throw new SqlRenderError(`Row for \`${table}\` is missing column \`${c.name}\``);
    }
    return renderValue(c, row[c.name] as RawValue);
  });
  return `INSERT INTO ${ident(table)} (${ordered.map((c) => ident(c.name)).join(', ')}) VALUES (${values.join(', ')});`;
}

export function renderDelete(
  table: string,
  keyColumns: readonly ColumnInfo[],
  key: Readonly<Record<string, string>>,
): string {
  const conds = keyColumns.map((c) => {
    if (!Object.prototype.hasOwnProperty.call(key, c.name)) {
      throw new SqlRenderError(`Key for \`${table}\` is missing column \`${c.name}\``);
    }
    return `${ident(c.name)} = ${renderValue(c, key[c.name] as string)}`;
  });
  if (conds.length === 0) throw new SqlRenderError(`Refusing DELETE on \`${table}\` without key columns`);
  return `DELETE FROM ${ident(table)} WHERE ${conds.join(' AND ')};`;
}
