import { defaultValueFor, isNumericColumn } from '@core/db/types';
import type { ColumnInfo, RawRow, RawValue, RefKind, Where } from '@core/db/types';
import {
  LOOKUP_KINDS,
  UnknownColumnError,
  UnknownTableError,
  type QuestSummary,
  type WorldDb,
} from '@core/db/world-db';
import { loadFork } from './ddl';

type MutableRow = Record<string, RawValue>;
interface Table {
  columns: ColumnInfo[];
  rows: MutableRow[];
}

/** kind -> [table, id column, name column] */
const LOOKUP: Partial<Record<RefKind, readonly [string, string, string]>> = {
  item: ['item_template', 'entry', 'name'],
  creature: ['creature_template', 'entry', 'name'],
  gameobject: ['gameobject_template', 'entry', 'name'],
  quest: ['quest_template', 'ID', 'LogTitle'],
};

const INTEGER = /^-?\d+$/;

function compareNumeric(a: RawValue, b: RawValue): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? -1 : 1;
  if (INTEGER.test(a) && INTEGER.test(b)) {
    const x = BigInt(a);
    const y = BigInt(b);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  return Number(a) - Number(b);
}

function compareText(a: RawValue, b: RawValue): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function lookupSpec(kind: RefKind): readonly [string, string, string] | undefined {
  return LOOKUP_KINDS.includes(kind) ? LOOKUP[kind] : undefined;
}

/** In-memory WorldDb for unit tests. Behaves like the MySQL implementation: text values, key ordering. */
export class FakeWorldDb implements WorldDb {
  private readonly tables = new Map<string, Table>();
  /** Tables the database has but this "user" may not read, as MySQL would hide them. */
  private readonly forbidden = new Set<string>();

  static fromFork(tables: string[]): FakeWorldDb {
    const db = new FakeWorldDb();
    for (const [name, columns] of Object.entries(loadFork(tables))) db.tables.set(name, { columns, rows: [] });
    return db;
  }

  private table(name: string): Table {
    const t = this.tables.get(name);
    if (!t) throw new UnknownTableError(name);
    return t;
  }

  private checkColumns(name: string, t: Table, names: Iterable<string>): void {
    const known = new Set(t.columns.map((c) => c.name));
    for (const n of names) if (!known.has(n)) throw new UnknownColumnError(name, n);
  }

  insert(table: string, partial: Record<string, string | null>): void {
    const t = this.table(table);
    this.checkColumns(table, t, Object.keys(partial));
    const row: MutableRow = {};
    for (const c of t.columns) row[c.name] = c.name in partial ? partial[c.name] : defaultValueFor(c);
    t.rows.push(row);
  }

  addColumn(table: string, col: ColumnInfo): void {
    const t = this.table(table);
    t.columns.push({ ...col });
    t.columns.sort((a, b) => a.ordinal - b.ordinal);
    for (const row of t.rows) row[col.name] = defaultValueFor(col);
  }

  dropTable(table: string): void {
    this.tables.delete(table);
  }

  /**
   * Makes a table invisible the way a missing `SELECT` grant does: `columns()` answers `[]`, just
   * as `INFORMATION_SCHEMA` would, but the probe can still tell it is there.
   */
  forbidTable(table: string): void {
    this.tables.delete(table);
    this.forbidden.add(table);
  }

  async probeMissingTable(table: string): Promise<'absent' | 'forbidden'> {
    return this.forbidden.has(table) ? 'forbidden' : 'absent';
  }

  update(table: string, where: Record<string, string>, partial: Record<string, string | null>): void {
    const t = this.table(table);
    this.checkColumns(table, t, [...Object.keys(where), ...Object.keys(partial)]);
    for (const row of t.rows) {
      if (Object.entries(where).every(([k, v]) => row[k] === v)) Object.assign(row, partial);
    }
  }

  all(table: string): RawRow[] {
    return this.table(table).rows.map((r) => ({ ...r }));
  }

  async columns(table: string): Promise<ColumnInfo[]> {
    const t = this.tables.get(table);
    return t ? t.columns.map((c) => ({ ...c })).sort((a, b) => a.ordinal - b.ordinal) : [];
  }

  async selectRows(table: string, where: Where): Promise<RawRow[]> {
    const t = this.table(table);
    this.checkColumns(table, t, Object.keys(where));
    const matches = t.rows.filter((row) =>
      Object.entries(where).every(([col, want]) =>
        typeof want === 'string' ? row[col] === want : want.some((w) => row[col] === w),
      ),
    );
    const keys = t.columns.filter((c) => c.isKey);
    const sorted = matches.slice().sort((a, b) => {
      for (const k of keys) {
        const cmp = (isNumericColumn(k) ? compareNumeric : compareText)(a[k.name], b[k.name]);
        if (cmp !== 0) return cmp;
      }
      return 0;
    });
    return sorted.map((r) => ({ ...r }));
  }

  async selectNonZero(table: string, column: string): Promise<RawRow[]> {
    this.checkColumns(table, this.table(table), [column]);
    return (await this.selectRows(table, {})).filter((row) => row[column] !== null && Number(row[column]) !== 0);
  }

  async searchQuests(text: string, limit: number): Promise<QuestSummary[]> {
    const rows = await this.selectRows('quest_template', {});
    const needle = text.toLowerCase();
    const hits = /^\d+$/.test(text)
      ? rows.filter((r) => r.ID !== null && BigInt(r.ID) === BigInt(text))
      : rows.filter((r) => (r.LogTitle ?? '').toLowerCase().includes(needle));
    return hits.slice(0, limit).map((r) => ({ id: Number(r.ID), title: r.LogTitle ?? '', level: Number(r.QuestLevel) }));
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
    return (await this.selectRows('quest_template', {}))
      .map((r) => Number(r.ID))
      .filter((id) => id >= from && id <= to);
  }

  async close(): Promise<void> {}
}
