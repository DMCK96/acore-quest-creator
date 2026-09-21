import type { ColumnInfo, RawRow, RefKind, Where } from './types';

export interface QuestSummary {
  id: number;
  title: string;
  level: number;
}

/** Reference kinds whose names can be looked up and whose existence can be checked. */
export const LOOKUP_KINDS: readonly RefKind[] = ['item', 'creature', 'gameobject', 'quest'];

export class UnknownTableError extends Error {
  constructor(public readonly table: string) {
    super(`Unknown table: ${table}`);
    this.name = 'UnknownTableError';
  }
}

export class UnknownColumnError extends Error {
  constructor(
    public readonly table: string,
    public readonly column: string,
  ) {
    super(`Unknown column: ${table}.${column}`);
    this.name = 'UnknownColumnError';
  }
}

/** Read-only view of the world database. Implemented by MySQL and by the in-memory fake. */
export interface WorldDb {
  /** Columns ordered by `ordinal`; `[]` for a table that does not exist. */
  columns(table: string): Promise<ColumnInfo[]>;
  /**
   * Every column as text or `null`, ordered by the table's key columns (numeric
   * columns numerically). `where` values are ANDed; an array means `IN`, and an
   * empty array matches nothing. Throws `UnknownTableError` / `UnknownColumnError`.
   */
  selectRows(table: string, where: Where): Promise<RawRow[]>;
  searchQuests(text: string, limit: number): Promise<QuestSummary[]>;
  /** Empty map for kinds outside `LOOKUP_KINDS`. */
  lookupNames(kind: RefKind, ids: readonly number[]): Promise<Map<number, string>>;
  /** Returns all requested ids for kinds outside `LOOKUP_KINDS` (existence unknown). */
  existingIds(kind: RefKind, ids: readonly number[]): Promise<Set<number>>;
  questIdsInRange(from: number, to: number): Promise<number[]>;
  close(): Promise<void>;
}
