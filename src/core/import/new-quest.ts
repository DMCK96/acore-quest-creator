import type { RawRow, SchemaInfo } from '../db/types';
import type { QuestAggregate, ReadOnlyReason } from '../model/aggregate';
import { CodecError, decodeList, decodeScalar } from '../registry/codec';
import type { FieldDef, FieldValue, Registry, ScalarType } from '../registry/types';
import { defaultRow, excludedFields } from './importer';

/** The quest's own key: a new quest owns its ID from the moment it is created. */
const ID_FIELD = 'quest_template.ID';

const isTextKind = (type: ScalarType): boolean => type.kind === 'string' || type.kind === 'text';

/**
 * The starting text of a column in a brand new row.
 *
 * A nullable text column with no default starts as NULL in the database, but a quest being written
 * is not a quest with "no title": the editor shows an empty box and the export writes `''`, like
 * the rest of the world data does.
 */
function startingValue(field: FieldDef & { shape: 'scalar' }, row: RawRow): string | null {
  const raw = row[field.column] ?? null;
  return raw === null && isTextKind(field.type) ? '' : raw;
}

/**
 * The aggregate a brand new quest starts from: every registry field the database can back, decoded
 * from that column's default, with the allocated ID in place.
 *
 * There is no snapshot, so nothing is carried over verbatim; the exporter emits the whole quest.
 * Fields in a missing or drifted table or column are left out exactly as they are on import, so the
 * form shows the same set of controls for a new quest as for an opened one.
 */
export function createNewAggregate(schema: SchemaInfo, registry: Registry, questId: number): QuestAggregate {
  const excluded = excludedFields(schema, registry);
  const values: Record<string, FieldValue> = {};
  const readOnly: ReadOnlyReason[] = [];

  for (const def of registry.tables) {
    if (!schema.tables[def.table]) continue;
    const fields = registry.fields.filter((f) => f.table === def.table && !excluded.has(f.id));
    if (fields.length === 0) continue;
    if (def.cardinality === 'many') {
      // A new quest starts with no relation, loot or POI rows at all.
      for (const field of fields) if (field.shape === 'rowset') values[field.id] = [];
      continue;
    }
    const row = defaultRow(def.table, schema, def.keyColumns[0], questId);
    for (const field of fields) decodeDefault(field, row, values, readOnly);
  }

  values[ID_FIELD] = questId;
  return { questId, isNew: true, values, readOnly, sharedItems: {} };
}

function decodeDefault(
  field: FieldDef,
  row: RawRow,
  values: Record<string, FieldValue>,
  readOnly: ReadOnlyReason[],
): void {
  if (field.shape === 'rowset') return; // a rowset never lives on a one-row table
  try {
    values[field.id] =
      field.shape === 'scalar' ? decodeScalar(field.type, startingValue(field, row)) : decodeList(field, row);
  } catch (error) {
    // A default the registry cannot read is drift like any other: the field is shown read-only.
    if (!(error instanceof CodecError)) throw error;
    readOnly.push({ fieldId: field.id, reason: error.message });
  }
}
