import type { RawRow, RawValue, SchemaInfo } from '../db/types';
import { defaultRow } from '../import/importer';
import type { QuestAggregate, Snapshot } from '../model/aggregate';
import {
  CodecError,
  decodeList,
  decodeRowSetRow,
  decodeScalar,
  encodeList,
  encodeRowSetRow,
  encodeScalar,
  valueEquals,
} from '../registry/codec';
import { columnsOfField, slotColumn } from '../registry/columns';
import type {
  FieldDef,
  ListFieldDef,
  ListValue,
  Registry,
  RowSetFieldDef,
  RowSetValue,
  ScalarValue,
  TableDef,
} from '../registry/types';

/** One statement of a re-applicable patch, still as data so it can be reviewed before it is rendered. */
export type PatchStatement =
  | { kind: 'delete'; table: string; key: Record<string, string> }
  | { kind: 'insert'; table: string; row: RawRow }
  | { kind: 'set-flag'; table: string; column: string; bit: number; key: Record<string, string> };

export interface PatchWarning {
  code: 'SHARED_ROW_MODIFIED' | 'LINKED_ROW_NOT_QUEST_ITEM' | 'QUESTGIVER_FLAG_ADDED';
  table: string;
  message: string;
}

export interface BuiltPatch {
  statements: PatchStatement[];
  warnings: PatchWarning[];
}

export interface BuildPatchInput {
  aggregate: QuestAggregate;
  snapshot: Snapshot | null;
  schema: SchemaInfo;
  registry: Registry;
  /** Creature entries that need `creature_template.npcflag` bit 2; the API layer works them out. */
  questGiverFixes?: readonly number[];
}

/** The creature flag the server needs before it honours a quest starter or ender. */
const QUEST_GIVER = { table: 'creature_template', column: 'npcflag', bit: 2 } as const;

type Key = Record<string, string>;

interface TablePatch {
  deletes: Key[];
  inserts: RawRow[];
}

const EMPTY: TablePatch = { deletes: [], inserts: [] };

/**
 * Turns an aggregate plus its import snapshot into the statements of one patch.
 *
 * Untouched values are carried over from the snapshot verbatim; only fields whose decoded value
 * differs from the decoded base row are re-encoded, and columns no field owns are never touched.
 */
export function buildPatch(input: BuildPatchInput): BuiltPatch {
  const { aggregate, snapshot, schema, registry, questGiverFixes = [] } = input;
  const readOnly = new Set(aggregate.readOnly.map((r) => r.fieldId));

  const byTable = new Map<string, TablePatch>();
  for (const def of registry.tables) {
    if (def.role !== 'owned') continue;
    if (!schema.tables[def.table]) continue;
    const rows = snapshot?.tables[def.table] ?? [];
    byTable.set(
      def.table,
      def.cardinality === 'one'
        ? buildOneRowTable(def, rows[0], aggregate, schema, registry, readOnly)
        : buildManyRowTable(def, rows, aggregate, schema, registry, readOnly),
    );
  }

  const statements: PatchStatement[] = [];
  // Deletes run in reverse registry order so dependants go before the rows they hang off.
  for (const def of [...registry.tables].reverse()) {
    for (const key of (byTable.get(def.table) ?? EMPTY).deletes) {
      statements.push({ kind: 'delete', table: def.table, key });
    }
  }

  const warnings: PatchWarning[] = [];
  // The flag has to be set before the relations land, so a half-applied patch never offers a quest
  // from an NPC the server will refuse.
  for (const entry of [...new Set(questGiverFixes)].sort((a, b) => a - b)) {
    statements.push({
      kind: 'set-flag',
      table: QUEST_GIVER.table,
      column: QUEST_GIVER.column,
      bit: QUEST_GIVER.bit,
      key: { entry: String(entry) },
    });
    warnings.push({
      code: 'QUESTGIVER_FLAG_ADDED',
      table: QUEST_GIVER.table,
      message: `Creature ${entry} will get the quest giver flag so the server offers or accepts quests from it.`,
    });
  }

  for (const def of registry.tables) {
    for (const row of (byTable.get(def.table) ?? EMPTY).inserts) {
      statements.push({ kind: 'insert', table: def.table, row });
    }
  }

  return { statements, warnings };
}

/** Fields of one table that the aggregate carries a decodable, writable value for. */
function editableFields(
  table: string,
  aggregate: QuestAggregate,
  registry: Registry,
  readOnly: ReadonlySet<string>,
): FieldDef[] {
  return registry.fields.filter(
    (f) => f.table === table && !readOnly.has(f.id) && Object.prototype.hasOwnProperty.call(aggregate.values, f.id),
  );
}

/** A one-to-one table keyed by the quest: one base row, overlaid field by field. */
function buildOneRowTable(
  def: TableDef,
  snapshotRow: RawRow | undefined,
  aggregate: QuestAggregate,
  schema: SchemaInfo,
  registry: Registry,
  readOnly: ReadonlySet<string>,
): TablePatch {
  const keyColumn = def.keyColumns[0];
  const base: Record<string, RawValue> = {
    ...(snapshotRow ?? defaultRow(def.table, schema, keyColumn, aggregate.questId)),
  };

  let overlaid = false;
  for (const field of editableFields(def.table, aggregate, registry, readOnly)) {
    if (field.shape === 'rowset') continue;
    // A field whose columns the fork does not have cannot be written back.
    if (!columnsOfField(field).every((c) => Object.prototype.hasOwnProperty.call(base, c))) continue;
    const current = decodeOrSkip(field, base);
    if (current === undefined) continue; // unreadable stored text: read-only, never overlaid
    const wanted = aggregate.values[field.id];
    if (valueEquals(current, wanted)) continue;
    Object.assign(
      base,
      field.shape === 'scalar'
        ? { [field.column]: encodeScalar(field.type, wanted as ScalarValue) }
        : encodeListOnto(field, wanted as ListValue, base, schema),
    );
    overlaid = true;
  }

  // A quest being created owns its key: the aggregate it was seeded from may name another ID.
  if (aggregate.isNew) base[keyColumn] = String(aggregate.questId);

  const emit = snapshotRow !== undefined || (aggregate.isNew && def.alwaysEmit === true) || overlaid;
  if (!emit) return EMPTY;
  return { deletes: [keyOf(def, base)], inserts: [base] };
}

/** A many-row table: the model rows replace the snapshot rows, matched by primary key. */
function buildManyRowTable(
  def: TableDef,
  snapshotRows: readonly RawRow[],
  aggregate: QuestAggregate,
  schema: SchemaInfo,
  registry: Registry,
  readOnly: ReadonlySet<string>,
): TablePatch {
  const field = registry.fields.find((f) => f.table === def.table && f.shape === 'rowset') as
    | RowSetFieldDef
    | undefined;
  if (!field) return EMPTY;

  const snapshotByKey = new Map(snapshotRows.map((row) => [keyText(def, row), row]));
  const writable = !readOnly.has(field.id) && Object.prototype.hasOwnProperty.call(aggregate.values, field.id);
  // Without an editable value the snapshot is the model, and every row goes back out verbatim.
  if (!writable) {
    return { deletes: snapshotRows.map((row) => keyOf(def, row)), inserts: [...snapshotRows] };
  }

  const inserts: RawRow[] = [];
  const keys: Key[] = [];
  const seen = new Set<string>();
  for (const value of aggregate.values[field.id] as RowSetValue) {
    const encoded: Record<string, RawValue> = { ...encodeRowSetRow(field, value) };
    if (field.questColumn !== undefined) encoded[field.questColumn] = String(aggregate.questId);
    Object.assign(encoded, field.fixedColumns ?? {});
    const text = keyText(def, encoded);
    const previous = snapshotByKey.get(text);
    // The single rows are wrapped in arrays only to reach the codec's one strict equality.
    let row: RawRow;
    if (previous === undefined) {
      row = { ...defaultRow(def.table, schema, field.questColumn ?? def.keyColumns[0], aggregate.questId), ...encoded };
    } else if (valueEquals([decodeRowSetRow(field, previous)], [value])) {
      row = previous; // untouched: verbatim, including columns no field models
    } else {
      row = { ...previous, ...encoded };
    }
    inserts.push(row);
    if (!seen.has(text)) {
      seen.add(text);
      keys.push(keyOf(def, row));
    }
  }

  // Rows dropped in the editor must still be deleted, so the keys are the union of both sides.
  const deletes = snapshotRows.filter((row) => !seen.has(keyText(def, row))).map((row) => keyOf(def, row));
  return { deletes: [...deletes, ...keys], inserts };
}

/** The decoded value of a field in a raw row, or `undefined` when the stored text cannot be read. */
function decodeOrSkip(field: FieldDef, row: RawRow): ListValue | ScalarValue | undefined {
  try {
    if (field.shape === 'scalar') return decodeScalar(field.type, row[field.column] ?? null);
    if (field.shape === 'list') return decodeList(field, row);
    return undefined;
  } catch (error) {
    if (error instanceof CodecError) return undefined;
    throw error;
  }
}

/**
 * Encodes a touched list, keeping NULL in the slots it does not use.
 *
 * `encodeList` fills an unused text slot with `''`, which would turn a stored NULL into an empty
 * string and lose fidelity for every slot the edit never went near. Where the column is nullable
 * and held NULL before, NULL is what goes back.
 */
function encodeListOnto(
  field: ListFieldDef,
  value: ListValue,
  base: RawRow,
  schema: SchemaInfo,
): Record<string, RawValue> {
  const encoded = encodeList(field, value);
  const nullable = new Set((schema.tables[field.table] ?? []).filter((c) => c.nullable).map((c) => c.name));
  for (let n = 1; n <= field.slots; n++) {
    if (value[n - 1] !== undefined) continue;
    for (const member of field.members) {
      if (member.type.kind !== 'string' && member.type.kind !== 'text') continue;
      const column = slotColumn(member.columnTemplate, n);
      if (nullable.has(column) && base[column] === null) encoded[column] = null;
    }
  }
  return encoded;
}

function keyOf(def: TableDef, row: RawRow): Key {
  const key: Key = {};
  for (const column of def.keyColumns) key[column] = row[column] ?? '';
  return key;
}

const keyText = (def: TableDef, row: RawRow): string => JSON.stringify(def.keyColumns.map((c) => row[c] ?? null));
