import type { ColumnInfo, SchemaInfo } from '../db/types';
import { columnTypes } from '../registry/columns';
import type { Registry, ScalarType } from '../registry/types';

export interface SchemaDiff {
  /** Registry tables the database does not have (including those it will not show this user). */
  missingTables: string[];
  /**
   * The subset of `missingTables` the database does have and this user may not read. Named apart
   * so the connect notice can say "ask for a grant" rather than "this fork lacks the table".
   */
  forbiddenTables: string[];
  /** Database columns no registry field owns in a table the tool writes (kept verbatim, never edited). Verbatim tables are excluded. */
  unregistered: { table: string; column: string }[];
  /** Registered columns the database lacks; the owning field is excluded from import/export. */
  missingColumns: { table: string; column: string; fieldId: string }[];
  /** Registered columns whose database type family does not fit the field type. */
  typeMismatches: { table: string; column: string; expected: string; actual: string; fieldId: string }[];
  /** Subset of `missingTables` that are owned, always-emitted tables. Consumed by `hasBlockingDrift`. */
  blockingTables: string[];
}

type Family = 'integer' | 'float' | 'string';

const INTEGER_TYPES: ReadonlySet<string> = new Set(['tinyint', 'smallint', 'mediumint', 'int', 'bigint']);
const FLOAT_TYPES: ReadonlySet<string> = new Set(['float', 'double', 'decimal']);
const STRING_TYPES: ReadonlySet<string> = new Set(['char', 'varchar', 'tinytext', 'text', 'mediumtext', 'longtext']);

const FAMILY_TYPES: Record<Family, ReadonlySet<string>> = {
  integer: INTEGER_TYPES,
  float: FLOAT_TYPES,
  string: STRING_TYPES,
};

const FAMILY_LABEL: Record<Family, string> = {
  integer: 'integer (tinyint, smallint, mediumint, int, bigint)',
  float: 'float (float, double, decimal)',
  string: 'string (char, varchar, text)',
};

function familyOf(type: ScalarType): Family {
  switch (type.kind) {
    case 'float':
      return 'float';
    case 'string':
    case 'text':
      return 'string';
    default:
      return 'integer';
  }
}

export function diffSchema(schema: SchemaInfo, registry: Registry): SchemaDiff {
  const diff: SchemaDiff = {
    missingTables: [],
    forbiddenTables: [],
    unregistered: [],
    missingColumns: [],
    typeMismatches: [],
    blockingTables: [],
  };

  const forbidden = new Set(schema.forbidden ?? []);
  for (const def of registry.tables) {
    if (schema.tables[def.table] || diff.missingTables.includes(def.table)) continue;
    diff.missingTables.push(def.table);
    if (forbidden.has(def.table)) diff.forbiddenTables.push(def.table);
    if (def.role === 'owned' && def.alwaysEmit) diff.blockingTables.push(def.table);
  }

  const tableNames = new Set(registry.tables.map((t) => t.table));
  const verbatimTables = new Set(registry.tables.filter((t) => t.role === 'verbatim').map((t) => t.table));
  for (const table of tableNames) {
    const dbColumns = schema.tables[table];
    if (!dbColumns) continue;
    const byName = new Map<string, ColumnInfo>(dbColumns.map((c) => [c.name, c]));
    const registered = new Set<string>();

    for (const field of registry.fields) {
      if (field.table !== table) continue;
      for (const [column, type] of Object.entries(columnTypes(field))) {
        registered.add(column);
        const actual = byName.get(column);
        if (!actual) {
          diff.missingColumns.push({ table, column, fieldId: field.id });
          continue;
        }
        const family = familyOf(type);
        if (!FAMILY_TYPES[family].has(actual.dataType)) {
          diff.typeMismatches.push({
            table,
            column,
            expected: FAMILY_LABEL[family],
            actual: actual.columnType,
            fieldId: field.id,
          });
        }
      }
    }

    // Verbatim tables are preserved wholesale by design; their columns are not "unmodelled".
    if (verbatimTables.has(table)) continue;
    for (const c of dbColumns) {
      if (!registered.has(c.name)) diff.unregistered.push({ table, column: c.name });
    }
  }
  return diff;
}

/** True when a table every quest needs (owned + alwaysEmit) is missing from the database. */
export function hasBlockingDrift(diff: SchemaDiff): boolean {
  return diff.blockingTables.length > 0;
}
