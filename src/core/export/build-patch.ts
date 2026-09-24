import type { RawRow, RawValue, SchemaInfo, Where } from '../db/types';
import { defaultColumnValues, defaultRow, questItemIds } from '../import/importer';
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
  | { kind: 'set-flag'; table: string; column: string; bit: number; key: Record<string, string> }
  /** Sets columns on one keyed row, only while `onlyIf` still holds, so a deliberate value is kept. */
  | { kind: 'update'; table: string; key: Record<string, string>; set: Record<string, string>; onlyIf?: Record<string, string> };

export interface PatchWarning {
  code:
    | 'SHARED_ROW_MODIFIED'
    | 'LINKED_ROW_NOT_QUEST_ITEM'
    | 'LINKED_ROW_COLLISION'
    | 'QUESTGIVER_FLAG_ADDED';
  table: string;
  message: string;
}

/**
 * Two rows of one many-row table share a primary key.
 *
 * A patch deletes by key and then inserts, so the pair would render one DELETE and two INSERTs and
 * the second INSERT would fail on the live server. The model has to be fixed, not the patch.
 */
export class DuplicateRowError extends Error {
  constructor(
    public readonly table: string,
    public readonly key: Record<string, string>,
  ) {
    super(
      `${table} has two rows with the same key ${JSON.stringify(key)}. ` +
        'Remove the duplicate before exporting; the database can only hold one of them.',
    );
    this.name = 'DuplicateRowError';
  }
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
  /**
   * Linked rows that belong to a creature or object the quest touches, but not to the quest.
   *
   * Defaults to whatever the snapshot recorded at import; the API passes a freshly read one so
   * entries the user added since then are covered too. Without it a new row can be allocated onto
   * a key another quest already holds, and the patch deletes that row (spec §4.2).
   */
  linkedContext?: Record<string, RawRow[]>;
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
  const context = input.linkedContext ?? snapshot?.linkedContext ?? {};

  const warnings: PatchWarning[] = [];
  const byTable = new Map<string, TablePatch>();
  for (const def of registry.tables) {
    // Locale rows are read so nothing is lost, and written by nobody.
    if (def.role === 'verbatim') continue;
    if (!schema.tables[def.table]) continue;
    const rows = snapshot?.tables[def.table] ?? [];
    byTable.set(
      def.table,
      def.role === 'linked'
        ? buildLinkedTable(def, rows, context[def.table] ?? [], aggregate, schema, registry, readOnly, warnings)
        : def.cardinality === 'one'
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
    // The key column is the quest itself: a quest being created gets its own ID below, so a stale
    // key value in the aggregate must not count as an edit (it would emit an otherwise empty row).
    if (field.shape === 'scalar' && def.keyColumns.includes(field.column)) continue;
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

/** How a model row of a many-row table stands against the row the snapshot holds under its key. */
type RowStatus = 'same' | 'changed' | 'new';

interface ModelRows {
  /** The rows the table should hold, in model order. */
  rows: { row: RawRow; status: RowStatus }[];
  /** Snapshot rows the model no longer holds. */
  removed: RawRow[];
}

/**
 * The rows a many-row table should hold, each matched to its snapshot row by primary key.
 *
 * `undefined` means the table has no rowset field to build from, so the patch leaves it alone.
 */
function modelRows(
  def: TableDef,
  snapshotRows: readonly RawRow[],
  aggregate: QuestAggregate,
  schema: SchemaInfo,
  registry: Registry,
  readOnly: ReadonlySet<string>,
  collisions?: CollisionGuard,
): ModelRows | undefined {
  const field = registry.fields.find((f) => f.table === def.table && f.shape === 'rowset') as
    | RowSetFieldDef
    | undefined;
  if (!field) return undefined;

  // Every key column has to come from the field (or its quest / fixed columns), or a row the editor
  // adds would be keyed by a default value and silently collide with the next one.
  const owned = new Set(columnsOfField(field));
  const unowned = def.keyColumns.filter((c) => !owned.has(c));
  if (unowned.length > 0) {
    throw new Error(
      `Registry error: ${def.table} is keyed by ${unowned.join(', ')}, which ${field.id} does not model.`,
    );
  }

  const snapshotByKey = new Map(snapshotRows.map((row) => [keyText(def, row), row]));
  const writable = !readOnly.has(field.id) && Object.prototype.hasOwnProperty.call(aggregate.values, field.id);
  // Without an editable value the snapshot is the model, and every row is untouched by definition.
  if (!writable) return { rows: snapshotRows.map((row) => ({ row, status: 'same' })), removed: [] };

  const rows: { row: RawRow; status: RowStatus }[] = [];
  const seen = new Set<string>();
  for (const value of aggregate.values[field.id] as RowSetValue) {
    const encoded: Record<string, RawValue> = { ...encodeRowSetRow(field, value) };
    if (field.questColumn !== undefined) encoded[field.questColumn] = String(aggregate.questId);
    Object.assign(encoded, field.fixedColumns ?? {});
    let text = keyText(def, encoded);

    // A key the quest did not import may already belong to somebody else. Where the key holds a
    // meaningless slot number the row moves to a free one; otherwise it takes over the row that is
    // there, keeping the columns this quest does not model. Either way it is never silent.
    let adopted: RawRow | undefined;
    if (collisions && !snapshotByKey.has(text)) {
      adopted = collisions.resolve(encoded, seen);
      text = keyText(def, encoded);
    }
    // One DELETE cannot clear two rows, so a duplicate key is a model error, not a patch to render.
    if (seen.has(text)) throw new DuplicateRowError(def.table, keyOf(def, encoded));
    seen.add(text);

    const previous = snapshotByKey.get(text);
    // The single rows are wrapped in arrays only to reach the codec's one strict equality.
    if (previous === undefined) {
      // Only the defaults: the key and the quest come from `encoded`, never from the quest ID.
      // An adopted row supplies the base instead, so nothing it holds outside the model is lost.
      rows.push({ row: { ...(adopted ?? defaultColumnValues(def.table, schema)), ...encoded }, status: 'new' });
    } else if (valueEquals([decodeRowSetRow(field, previous)], [value])) {
      rows.push({ row: previous, status: 'same' }); // verbatim, including columns no field models
    } else {
      rows.push({ row: { ...previous, ...encoded }, status: 'changed' });
    }
  }

  return { rows, removed: snapshotRows.filter((row) => !seen.has(keyText(def, row))) };
}

/**
 * Keeps a new linked row off a key that belongs to a row the quest never imported.
 *
 * The linked `where` clauses find rows by item, so everything else on the same creature or object
 * is missing from the snapshot. `resolve` is handed the encoded row before its key is committed:
 * it either moves the row to a free slot (and returns nothing) or hands back the row being taken
 * over, so the caller can build on it instead of on the column defaults. Both paths warn.
 */
class CollisionGuard {
  private readonly byKey = new Map<string, RawRow>();
  /** Keys that are taken but are the quest's own, so a moved row must not land on them either. */
  private readonly occupied = new Set<string>();

  constructor(
    private readonly def: TableDef,
    contextRows: readonly RawRow[],
    snapshotRows: readonly RawRow[],
    private readonly warnings: PatchWarning[],
  ) {
    for (const row of contextRows) this.byKey.set(keyText(def, row), row);
    for (const row of snapshotRows) this.occupied.add(keyText(def, row));
  }

  resolve(encoded: Record<string, RawValue>, seen: ReadonlySet<string>): RawRow | undefined {
    const clash = this.byKey.get(keyText(this.def, encoded));
    if (clash === undefined) return undefined;

    const slot = this.def.allocatableKeyColumn;
    if (slot !== undefined) {
      const moved = this.freeSlot(encoded, seen);
      this.warnings.push({
        code: 'LINKED_ROW_COLLISION',
        table: this.def.table,
        message:
          `${this.def.entryColumn ?? 'entry'} ${encoded[this.def.entryColumn ?? ''] ?? '?'} already uses ` +
          `${slot} ${encoded[slot] ?? '?'} for ${this.def.itemColumn ?? 'item'} ${clash[this.def.itemColumn ?? ''] ?? '?'}, ` +
          `which this quest does not own; this row was moved to ${slot} ${moved} so that one is left alone.`,
      });
      encoded[slot] = moved;
      return undefined;
    }

    // The key names the thing itself (creature + item), so there is nowhere to move to: this is
    // the same row. It is replaced, not added — and the patch says exactly what it is replacing.
    const shown = Object.keys(clash)
      .filter((c) => !this.def.keyColumns.includes(c))
      .map((c) => `${c}=${clash[c] === null ? 'NULL' : clash[c]}`)
      .join(', ');
    this.warnings.push({
      code: 'LINKED_ROW_COLLISION',
      table: this.def.table,
      message:
        `${this.def.table} already has a row for ${this.def.keyColumns.map((c) => `${c}=${encoded[c] ?? 'NULL'}`).join(', ')} ` +
        `that this quest did not import (${shown}). The patch replaces that row instead of adding a second one, ` +
        'so check the values above before applying it.',
    });
    return clash;
  }

  /** The lowest non-negative slot no context row, snapshot row or earlier model row is using. */
  private freeSlot(encoded: Record<string, RawValue>, seen: ReadonlySet<string>): string {
    const slot = this.def.allocatableKeyColumn as string;
    for (let n = 0; n < 10_000; n++) {
      const candidate = { ...encoded, [slot]: String(n) };
      const text = keyText(this.def, candidate);
      if (!this.byKey.has(text) && !this.occupied.has(text) && !seen.has(text)) return String(n);
    }
    throw new Error(`${this.def.table}: no free ${slot} left for ${JSON.stringify(keyOf(this.def, encoded))}.`);
  }

  /** True for a key held by a row the quest never imported: the patch must not delete it. */
  holds(row: RawRow): boolean {
    return this.byKey.has(keyText(this.def, row));
  }
}

/** A many-row table the quest owns: every model row is rewritten, every dropped row deleted. */
function buildManyRowTable(
  def: TableDef,
  snapshotRows: readonly RawRow[],
  aggregate: QuestAggregate,
  schema: SchemaInfo,
  registry: Registry,
  readOnly: ReadonlySet<string>,
): TablePatch {
  const model = modelRows(def, snapshotRows, aggregate, schema, registry, readOnly);
  if (model === undefined) return EMPTY;
  // Rows dropped in the editor must still be deleted, so the keys are the union of both sides.
  const deletes = model.removed.map((row) => keyOf(def, row));
  return {
    deletes: [...deletes, ...model.rows.map((r) => keyOf(def, r.row))],
    inserts: model.rows.map((r) => r.row),
  };
}

/**
 * A linked table: rows found by item, which another quest may own just as much as this one.
 *
 * Only the rows this edit actually touched are written, so a patch never rewrites a row it merely
 * read, and each statement names one exact primary key: no `DELETE ... WHERE Item = X` that would
 * take another quest's rows with it.
 */
function buildLinkedTable(
  def: TableDef,
  snapshotRows: readonly RawRow[],
  contextRows: readonly RawRow[],
  aggregate: QuestAggregate,
  schema: SchemaInfo,
  registry: Registry,
  readOnly: ReadonlySet<string>,
  warnings: PatchWarning[],
): TablePatch {
  const guard = new CollisionGuard(def, contextRows, snapshotRows, warnings);
  const model = modelRows(def, snapshotRows, aggregate, schema, registry, readOnly, guard);
  if (model === undefined) return EMPTY;

  const touched = model.rows.filter((r) => r.status !== 'same').map((r) => r.row);
  warnLinked(def, aggregate, registry, [...touched, ...model.removed], touched, warnings);
  // A row the quest dropped from its model is deleted by key — unless that key is one the context
  // holds, which would mean deleting somebody else's row on the way out.
  const removed = model.removed.filter((row) => !guard.holds(row));
  return {
    deletes: [...removed, ...touched].map((row) => keyOf(def, row)),
    inserts: touched,
  };
}

/** Whether the next import's query for a linked table would find this row again. */
function matchesWhere(row: RawRow, where: Where): boolean {
  return Object.entries(where).every(([column, want]) => {
    const value = row[column] ?? null;
    if (value === null) return false;
    return typeof want === 'string' ? value === want : want.includes(value);
  });
}

/**
 * The two things the user cannot see from the form: that a touched row belongs to another quest
 * too, and that a row they added will not be found by the next import of this quest.
 */
function warnLinked(
  def: TableDef,
  aggregate: QuestAggregate,
  registry: Registry,
  touchedOrRemoved: readonly RawRow[],
  touched: readonly RawRow[],
  warnings: PatchWarning[],
): void {
  const itemColumn = def.itemColumn;
  if (itemColumn === undefined) return;

  for (const row of touchedOrRemoved) {
    const item = row[itemColumn];
    const shared = item === null ? undefined : aggregate.sharedItems[item];
    if (!Array.isArray(shared) || shared.length === 0) continue;
    const many = shared.length > 1;
    warnings.push({
      code: 'SHARED_ROW_MODIFIED',
      table: def.table,
      message:
        `This row's item is also used by quest${many ? 's' : ''} ${shared.join(', ')}; ` +
        `changing it affects ${many ? 'those quests' : 'that quest'} too.`,
    });
  }

  // The where-clause the importer will use is the whole rule: the item has to be one of the
  // quest's, and a loot row has to be marked as a quest drop.
  const where = def.where(aggregate.questId, questItemIds(aggregate.values, registry));
  for (const row of touched) {
    if (matchesWhere(row, where)) continue;
    warnings.push({
      code: 'LINKED_ROW_NOT_QUEST_ITEM',
      table: def.table,
      message:
        `Item ${row[itemColumn] ?? 'NULL'} is not one of this quest's items (or QuestRequired is not 1), ` +
        'so the next import will not find this row.',
    });
  }
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
