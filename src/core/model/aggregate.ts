import type { RawRow } from '../db/types';
import type { FieldValue } from '../registry/types';

/** Why one field cannot be edited: its stored text has no representation in the registry. */
export interface ReadOnlyReason {
  fieldId: string;
  reason: string;
}

/** Everything the tool reads, edits and writes for one quest ID, decoded through the registry. */
export interface QuestAggregate {
  questId: number;
  /** True for a quest that does not exist in the world DB yet. */
  isNew: boolean;
  /** Field id -> decoded value. A field that could not be decoded is absent. */
  values: Record<string, FieldValue>;
  readOnly: ReadOnlyReason[];
  /** Linked row key -> the quest IDs that also own it (filled from Task 15 on). */
  sharedItems: Record<string, number[]>;
}

/** The rows exactly as fetched. Nothing is recomputed from them; they are the fidelity baseline. */
export interface Snapshot {
  questId: number;
  /** Table -> raw rows, verbatim. A table absent from the database has no rows. */
  tables: Record<string, RawRow[]>;
  /** Table -> the column names read, in ordinal order. */
  columnsRead: Record<string, string[]>;
  schemaHash: string;
}
