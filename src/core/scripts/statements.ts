import type { SchemaInfo } from '../db/types';
import type { PatchStatement } from '../export/build-patch';
import { defaultColumnValues } from '../import/importer';
import type { CompiledScripts } from './compile';

/** Deletes run dependants first, so a half-applied patch never leaves conditions on a missing row. */
const DELETE_ORDER = [
  'conditions',
  'smart_scripts',
  'creature_text',
  'waypoints',
  'gossip_menu_option',
  'areatrigger_scripts',
  'areatrigger',
  // New NPCs and objects (slice D): loot and spawns before the templates they belong to.
  'creature_loot_template',
  'gameobject_loot_template',
  'creature',
  'gameobject',
  'creature_template_model',
  'creature_template',
  'gameobject_template',
  'page_text',
] as const;

/** Inserts run in the order the server needs them: what a row points at exists before the row. */
const INSERT_ORDER = [
  'creature_template',
  'creature_template_model',
  'page_text',
  'gameobject_template',
  'creature',
  'gameobject',
  'creature_loot_template',
  'gameobject_loot_template',
  'areatrigger',
  'areatrigger_scripts',
  'npc_text',
  'gossip_menu',
  'gossip_menu_option',
  'waypoints',
  'creature_text',
  'smart_scripts',
  'conditions',
] as const;

/**
 * Compiled script rows as patch statements. Each partial row is completed with the column defaults
 * of the connected schema; a column this fork does not have is left out rather than failing the
 * export. A table the fork lacks gets no statements and is named in `missingTables` instead.
 */
export function scriptStatements(
  compiled: CompiledScripts,
  schema: SchemaInfo,
): { statements: PatchStatement[]; missingTables: string[] } {
  const missing = new Set<string>();
  const has = (table: string): boolean => {
    if (schema.tables[table]) return true;
    missing.add(table);
    return false;
  };

  const statements: PatchStatement[] = [];
  const deleteTables = [...DELETE_ORDER, ...Object.keys(compiled.deletes).filter((t) => !(DELETE_ORDER as readonly string[]).includes(t))];
  for (const table of deleteTables) {
    const keys = compiled.deletes[table] ?? [];
    if (keys.length === 0 || !has(table)) continue;
    for (const key of keys) statements.push({ kind: 'delete', table, key });
  }
  for (const flag of compiled.flags) {
    if (has(flag.table)) statements.push({ kind: 'set-flag', ...flag });
  }
  for (const update of compiled.updates) {
    if (has(update.table)) statements.push({ kind: 'update', ...update });
  }
  const insertTables = [...INSERT_ORDER, ...Object.keys(compiled.inserts).filter((t) => !(INSERT_ORDER as readonly string[]).includes(t))];
  for (const table of insertTables) {
    const rows = compiled.inserts[table] ?? [];
    if (rows.length === 0 || !has(table)) continue;
    const known = new Set(schema.tables[table]!.map((c) => c.name));
    for (const partial of rows) {
      const row: Record<string, string | null> = { ...defaultColumnValues(table, schema) };
      for (const [column, value] of Object.entries(partial)) if (known.has(column)) row[column] = value;
      statements.push({ kind: 'insert', table, row });
    }
  }
  return { statements, missingTables: [...missing].sort() };
}
