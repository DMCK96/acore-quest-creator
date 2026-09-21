import type { RefKind, Where } from '../db/types';

export type EditorGroup = 'identity' | 'story' | 'objectives' | 'rewards' | 'availability' | 'map';

export type ScalarType =
  | { kind: 'int'; min?: number; max?: number }
  | { kind: 'float' }
  | { kind: 'string' }
  | { kind: 'text' }
  | { kind: 'enum'; options: readonly { value: number; label: string }[] }
  | { kind: 'flags'; flags: readonly { bit: number; label: string }[] }
  | { kind: 'idRef'; target: RefKind }
  | { kind: 'money' }
  | { kind: 'creatureOrGo' };

export interface CreatureOrGoValue {
  target: 'creature' | 'gameobject';
  id: number;
}

export type ScalarValue = number | string | null | CreatureOrGoValue;
export type ListValue = Array<Record<string, ScalarValue>>;
export type RowSetValue = Array<Record<string, ScalarValue>>;
export type FieldValue = ScalarValue | ListValue | RowSetValue;

export type ControlId =
  | 'raceMask'
  | 'classMask'
  | 'xpDifficulty'
  | 'moneyDifficulty'
  | 'questSort'
  | 'emote'
  | 'starters'
  | 'enders'
  | 'poi';

export interface ScalarFieldDef {
  shape: 'scalar';
  id: string;
  table: string;
  column: string;
  type: ScalarType;
  label: string;
  help: string;
  group: EditorGroup;
  advanced?: boolean;
  readOnlyUi?: boolean;
  control?: ControlId;
  /** The column holds an item ID whose linked loot rows belong to the quest. */
  linksItems?: boolean;
}

export interface ListMemberDef {
  name: string;
  /** Column name with `{n}` replaced by the slot number 1..slots. */
  columnTemplate: string;
  type: ScalarType;
  label: string;
}

export interface ListFieldDef {
  shape: 'list';
  id: string;
  table: string;
  slots: number;
  members: readonly ListMemberDef[];
  label: string;
  help: string;
  group: EditorGroup;
  advanced?: boolean;
  control?: ControlId;
  /** Members whose item IDs make linked loot rows findable. */
  linksItems?: readonly string[];
}

export interface RowSetColumn {
  name: string;
  type: ScalarType;
  label: string;
}

export interface RowSetFieldDef {
  shape: 'rowset';
  id: string;
  table: string;
  columns: readonly RowSetColumn[];
  questColumn?: string;
  fixedColumns?: Readonly<Record<string, string>>;
  label: string;
  help: string;
  group: EditorGroup;
  advanced?: boolean;
  control?: ControlId;
  linked?: boolean;
}

export type FieldDef = ScalarFieldDef | ListFieldDef | RowSetFieldDef;

export interface TableDef {
  table: string;
  role: 'owned' | 'linked' | 'verbatim';
  cardinality: 'one' | 'many';
  keyColumns: readonly string[];
  alwaysEmit?: boolean;
  /** For a linked table, the column holding the item ID that ties the row to the quest. */
  itemColumn?: string;
  where(questId: number, itemIds: readonly number[]): Where;
}

export interface Registry {
  tables: readonly TableDef[];
  fields: readonly FieldDef[];
}
