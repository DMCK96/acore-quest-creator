import { questTemplateAddonFields, questTemplateAddonTable } from './fields/quest-template-addon';
import { questTemplateFields, questTemplateTable } from './fields/quest-template';
import type { EditorGroup, FieldDef, Registry, TableDef } from './types';

/**
 * The single source of truth the importer, exporter, form and round-trip gate all read.
 * Tables and fields are concatenated in a fixed order so the emitted patch is stable.
 */
export const registry: Registry = {
  tables: [questTemplateTable, questTemplateAddonTable],
  fields: [...questTemplateFields, ...questTemplateAddonFields],
};

const fieldsById = new Map<string, FieldDef>(registry.fields.map((f) => [f.id, f]));
const tablesByName = new Map<string, TableDef>(registry.tables.map((t) => [t.table, t]));

export function fieldById(id: string): FieldDef | undefined {
  return fieldsById.get(id);
}

export function fieldsOfTable(table: string): readonly FieldDef[] {
  return registry.fields.filter((f) => f.table === table);
}

export function fieldsOfGroup(group: EditorGroup): readonly FieldDef[] {
  return registry.fields.filter((f) => f.group === group);
}

export function tableDef(table: string): TableDef {
  const def = tablesByName.get(table);
  if (!def) throw new Error(`Unknown table in registry: ${table}`);
  return def;
}
