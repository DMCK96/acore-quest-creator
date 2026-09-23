import type { ColumnInfo, RawRow, RefKind, Where } from './types';
import type { EntityHit, SearchKind } from './entity-search';

export type { EntityHit, SearchKind } from './entity-search';

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
  /** Columns ordered by `ordinal`; `[]` for a table that does not exist *or* is not readable. */
  columns(table: string): Promise<ColumnInfo[]>;
  /**
   * For a table `columns()` came back empty for: whether it is genuinely absent from this fork, or
   * present but hidden from this user by a missing grant. Optional — an implementation that cannot
   * tell the difference simply omits it and every such table counts as absent.
   */
  probeMissingTable?(table: string): Promise<'absent' | 'forbidden'>;
  /**
   * Every column as text or `null`, ordered by the table's key columns (numeric
   * columns numerically). `where` values are ANDed; an array means `IN`, and an
   * empty array matches nothing. Throws `UnknownTableError` / `UnknownColumnError`.
   */
  selectRows(table: string, where: Where): Promise<RawRow[]>;
  /**
   * Every row whose numeric `column` is not zero, in `selectRows`' order and shape. `selectRows` can
   * only ask for known values, and some reads want "anything set" from a big table with no index on
   * the column (item starters: a few hundred of half a million items), which must be one pass rather
   * than an `IN` scan per call. Optional: without it the caller filters a full `selectRows` itself.
   * Throws `UnknownTableError` / `UnknownColumnError`.
   */
  selectNonZero?(table: string, column: string): Promise<RawRow[]>;
  searchQuests(text: string, limit: number): Promise<QuestSummary[]>;
  /**
   * Entities whose ID is `text` (a whole number) or whose name contains it, case-insensitively:
   * exact names first, then prefixes, then by ID. Blank text finds nothing.
   */
  searchEntities(kind: SearchKind, text: string, limit: number): Promise<EntityHit[]>;
  /** Empty map for kinds outside `LOOKUP_KINDS`. */
  lookupNames(kind: RefKind, ids: readonly number[]): Promise<Map<number, string>>;
  /** Returns all requested ids for kinds outside `LOOKUP_KINDS` (existence unknown). */
  existingIds(kind: RefKind, ids: readonly number[]): Promise<Set<number>>;
  questIdsInRange(from: number, to: number): Promise<number[]>;
  close(): Promise<void>;
}
