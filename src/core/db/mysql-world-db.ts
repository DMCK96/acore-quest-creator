import mysql from 'mysql2/promise';
import type { Pool, Field } from 'mysql2/promise';
import { ident } from '../sql/render';
import type { ColumnInfo, RawRow, RawValue, RefKind, Where } from './types';
import { isNumericColumn } from './types';
import { LOOKUP_KINDS, UnknownColumnError, UnknownTableError, type QuestSummary, type WorldDb } from './world-db';

export interface MysqlWorldDbOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/** Thrown when the pool cannot reach or authenticate against the MySQL server. */
export class WorldDbConnectionError extends Error {
  constructor(host: string, port: number, code: string, cause?: unknown) {
    super(`Cannot connect to MySQL at ${host}:${port} (${code})`);
    this.name = 'WorldDbConnectionError';
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

/** kind -> [table, id column, name column] */
const LOOKUP: Partial<Record<RefKind, readonly [string, string, string]>> = {
  item: ['item_template', 'entry', 'name'],
  creature: ['creature_template', 'entry', 'name'],
  gameobject: ['gameobject_template', 'entry', 'name'],
  quest: ['quest_template', 'ID', 'LogTitle'],
};

function lookupSpec(kind: RefKind): readonly [string, string, string] | undefined {
  return LOOKUP_KINDS.includes(kind) ? LOOKUP[kind] : undefined;
}

const CONNECTION_ERROR_CODES: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ER_ACCESS_DENIED_ERROR',
  'ER_BAD_DB_ERROR',
  'ETIMEDOUT',
  'PROTOCOL_CONNECTION_LOST',
  'ENOTFOUND',
  'EHOSTUNREACH',
]);

function isConnectionError(err: unknown): err is NodeJS.ErrnoException & { code: string } {
  return typeof err === 'object' && err !== null && 'code' in err && typeof (err as { code: unknown }).code === 'string';
}

function wrapConnectionError(host: string, port: number, err: unknown): never {
  if (isConnectionError(err)) {
    const code = err.code;
    if (CONNECTION_ERROR_CODES.has(code) || /timeout/i.test(String((err as Error).message))) {
      throw new WorldDbConnectionError(host, port, code, err);
    }
    throw new WorldDbConnectionError(host, port, code, err);
  }
  throw new WorldDbConnectionError(host, port, 'UNKNOWN', err);
}

/** Escapes `%` and `_` in LIKE search text, backslash first. */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const INTEGER_TEXT = /^-?\d+$/;
const DECIMAL_TEXT = /^-?\d+(\.\d+)?$/;
const FLOAT_TYPES: ReadonlySet<string> = new Set(['float', 'double', 'decimal']);

/**
 * Whether `value` is a clean textual literal for `col`'s numeric type.
 *
 * MySQL compares a numeric column to a bound string parameter by coercing the
 * string's leading numeric prefix (e.g. `"1' OR '1'='1"` -> `1`), even under
 * strict sql_mode, since that coercion happens for WHERE-clause comparisons,
 * not for INSERT/UPDATE truncation. Rejecting anything but a clean numeric
 * literal before binding stops garbage input from spuriously matching a real
 * row via that loose coercion.
 */
function isValidNumericLiteral(col: ColumnInfo, value: string): boolean {
  return (FLOAT_TYPES.has(col.dataType) ? DECIMAL_TEXT : INTEGER_TEXT).test(value);
}

class MysqlWorldDb implements WorldDb {
  private readonly columnCache = new Map<string, ColumnInfo[]>();

  constructor(
    private readonly pool: Pool,
    private readonly host: string,
    private readonly port: number,
  ) {}

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      wrapConnectionError(this.host, this.port, err);
    }
  }

  async columns(table: string): Promise<ColumnInfo[]> {
    const cached = this.columnCache.get(table);
    if (cached) return cached;

    const rows = await this.run(async () => {
      const [result] = await this.pool.query(
        `SELECT c.COLUMN_NAME AS name, c.DATA_TYPE AS dataType, c.COLUMN_TYPE AS columnType,
                c.IS_NULLABLE AS nullable, c.COLUMN_DEFAULT AS defaultValue, c.ORDINAL_POSITION AS ordinal,
                (k.COLUMN_NAME IS NOT NULL) AS isKey
         FROM INFORMATION_SCHEMA.COLUMNS c
         LEFT JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
           ON k.TABLE_SCHEMA = c.TABLE_SCHEMA AND k.TABLE_NAME = c.TABLE_NAME
          AND k.COLUMN_NAME = c.COLUMN_NAME AND k.CONSTRAINT_NAME = 'PRIMARY'
         WHERE c.TABLE_SCHEMA = DATABASE() AND c.TABLE_NAME = ?
         ORDER BY c.ORDINAL_POSITION`,
        [table],
      );
      return result as Array<{
        name: string;
        dataType: string;
        columnType: string;
        nullable: string;
        defaultValue: string | null;
        ordinal: number | string;
        isKey: number | string;
      }>;
    });

    const cols: ColumnInfo[] = rows.map((r) => ({
      name: r.name,
      dataType: r.dataType.toLowerCase(),
      columnType: r.columnType,
      nullable: r.nullable === 'YES',
      default: r.defaultValue,
      ordinal: Number(r.ordinal),
      isKey: Number(r.isKey) === 1,
    }));

    this.columnCache.set(table, cols);
    return cols;
  }

  private async knownColumns(table: string): Promise<ColumnInfo[]> {
    const cols = await this.columns(table);
    if (cols.length === 0) throw new UnknownTableError(table);
    return cols;
  }

  private async checkColumns(table: string, cols: ColumnInfo[], names: Iterable<string>): Promise<void> {
    const known = new Set(cols.map((c) => c.name));
    for (const n of names) if (!known.has(n)) throw new UnknownColumnError(table, n);
  }

  async selectRows(table: string, where: Where): Promise<RawRow[]> {
    const cols = await this.knownColumns(table);
    await this.checkColumns(table, cols, Object.keys(where));

    const conds: string[] = [];
    const params: string[] = [];
    for (const [col, val] of Object.entries(where)) {
      const colInfo = cols.find((c) => c.name === col);
      const numeric = colInfo !== undefined && isNumericColumn(colInfo);
      if (Array.isArray(val)) {
        if (val.length === 0) return [];
        // For a numeric column, drop values that aren't clean numeric literals
        // rather than letting MySQL's loose WHERE-clause coercion decide.
        const values = numeric ? val.filter((v) => isValidNumericLiteral(colInfo!, v)) : val;
        if (values.length === 0) return [];
        conds.push(`${ident(col)} IN (${values.map(() => '?').join(', ')})`);
        params.push(...values);
      } else {
        if (numeric && !isValidNumericLiteral(colInfo!, val as string)) return [];
        conds.push(`${ident(col)} = ?`);
        params.push(val as string);
      }
    }

    const keyCols = cols.filter((c) => c.isKey);
    const orderBy = keyCols.length > 0 ? ` ORDER BY ${keyCols.map((c) => ident(c.name)).join(', ')}` : '';
    const whereSql = conds.length > 0 ? ` WHERE ${conds.join(' AND ')}` : '';
    const sql = `SELECT * FROM ${ident(table)}${whereSql}${orderBy}`;

    const rows = await this.run(async () => {
      const [result] = await this.pool.query(sql, params);
      return result as RawRow[];
    });
    return rows.map((r) => ({ ...r }));
  }

  async searchQuests(text: string, limit: number): Promise<QuestSummary[]> {
    await this.knownColumns('quest_template');
    const sql = INTEGER_TEXT.test(text)
      ? `SELECT ${ident('ID')}, ${ident('LogTitle')}, ${ident('QuestLevel')} FROM ${ident('quest_template')} WHERE ${ident('ID')} = ? ORDER BY ${ident('ID')} LIMIT ?`
      : `SELECT ${ident('ID')}, ${ident('LogTitle')}, ${ident('QuestLevel')} FROM ${ident('quest_template')} WHERE ${ident('LogTitle')} LIKE ? ESCAPE '\\\\' ORDER BY ${ident('ID')} LIMIT ?`;
    const param = INTEGER_TEXT.test(text) ? text : `%${escapeLike(text)}%`;

    const rows = await this.run(async () => {
      const [result] = await this.pool.query(sql, [param, limit]);
      return result as Array<{ ID: string; LogTitle: string | null; QuestLevel: string | null }>;
    });
    return rows.map((r) => ({ id: Number(r.ID), title: r.LogTitle ?? '', level: Number(r.QuestLevel) }));
  }

  async lookupNames(kind: RefKind, ids: readonly number[]): Promise<Map<number, string>> {
    const out = new Map<number, string>();
    const spec = lookupSpec(kind);
    if (!spec || ids.length === 0) return out;
    const [table, idCol, nameCol] = spec;
    const rows = await this.selectRows(table, { [idCol]: ids.map(String) });
    for (const r of rows) out.set(Number(r[idCol]), r[nameCol] ?? '');
    return out;
  }

  async existingIds(kind: RefKind, ids: readonly number[]): Promise<Set<number>> {
    const spec = lookupSpec(kind);
    if (!spec) return new Set(ids);
    if (ids.length === 0) return new Set();
    const [table, idCol] = spec;
    const rows = await this.selectRows(table, { [idCol]: ids.map(String) });
    return new Set(rows.map((r) => Number(r[idCol])));
  }

  async questIdsInRange(from: number, to: number): Promise<number[]> {
    const rows = await this.run(async () => {
      const [result] = await this.pool.query(
        `SELECT ${ident('ID')} FROM ${ident('quest_template')} WHERE ${ident('ID')} BETWEEN ? AND ? ORDER BY ${ident('ID')} ASC`,
        [from, to],
      );
      return result as Array<{ ID: string }>;
    });
    return rows.map((r) => Number(r.ID));
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export async function openMysqlWorldDb(opts: MysqlWorldDbOptions): Promise<WorldDb> {
  const pool = mysql.createPool({
    host: opts.host,
    port: opts.port,
    user: opts.user,
    password: opts.password,
    database: opts.database,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    decimalNumbers: false,
    connectTimeout: 5_000,
    typeCast: (field: Field, _next: () => unknown) => field.string(),
  });

  try {
    const conn = await pool.getConnection();
    conn.release();
  } catch (err) {
    await pool.end().catch(() => undefined);
    wrapConnectionError(opts.host, opts.port, err);
  }

  return new MysqlWorldDb(pool, opts.host, opts.port);
}
