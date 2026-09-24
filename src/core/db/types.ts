/** A database value carried as text end to end; `null` is SQL NULL. */
export type RawValue = string | null;

/** One row keyed by column name, all values as text. */
export type RawRow = Readonly<Record<string, RawValue>>;

/** Equality filter: column -> one value, or any of several values. */
export type Where = Readonly<Record<string, string | readonly string[]>>;

export type RefKind =
  | 'item'
  | 'creature'
  | 'gameobject'
  | 'quest'
  | 'spell'
  | 'sound'
  | 'faction'
  | 'title'
  | 'areatrigger'
  | 'map'
  | 'emote'
  | 'zone'
  | 'skill'
  | 'mailTemplate';

export interface ColumnInfo {
  name: string;
  /** Lower-case base type, e.g. `int`, `mediumint`, `varchar`, `float`. */
  dataType: string;
  /** Full declaration, e.g. `mediumint unsigned`. */
  columnType: string;
  nullable: boolean;
  default: string | null;
  ordinal: number;
  isKey: boolean;
}

export interface SchemaInfo {
  /** Columns per table, ordered by `ordinal`. */
  tables: Record<string, ColumnInfo[]>;
  /**
   * Tables that exist in the database but this user may not read, sorted. They are absent from
   * `tables` exactly like a table the fork does not have, which is the whole reason they are named
   * separately: a missing grant must not be reported as a missing table, nor quietly imported around.
   */
  forbidden: string[];
  hash: string;
}

const NUMERIC_TYPES: ReadonlySet<string> = new Set([
  'tinyint', 'smallint', 'mediumint', 'int', 'bigint', 'float', 'double', 'decimal',
]);

export function isNumericColumn(col: ColumnInfo): boolean {
  return NUMERIC_TYPES.has(col.dataType);
}

/** The value a fresh row gets for a column: its default, else NULL, else 0 / ''. */
export function defaultValueFor(col: ColumnInfo): RawValue {
  if (col.default !== null) return col.default;
  if (col.nullable) return null;
  return isNumericColumn(col) ? '0' : '';
}
