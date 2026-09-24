import type { ColumnInfo, SchemaInfo } from '../db/types';
import { SqlRenderError, ident, renderDelete, renderInsert, renderValue } from '../sql/render';
import type { PatchStatement } from './build-patch';

export interface PatchMeta {
  toolVersion: string;
  questId: number;
  date: string;
}

const UNSIGNED_INT_TEXT = /^\d+$/;
/** Slug length that keeps the whole file name comfortably inside path limits. */
const SLUG_MAX = 40;

function columnsOf(schema: SchemaInfo, table: string): ColumnInfo[] {
  const columns = schema.tables[table];
  if (!columns) throw new SqlRenderError(`Table \`${table}\` is not in the loaded schema`);
  return columns;
}

function keyColumnsOf(schema: SchemaInfo, table: string, names: readonly string[]): ColumnInfo[] {
  const byName = new Map(columnsOf(schema, table).map((c) => [c.name, c]));
  return names.map((name) => {
    const column = byName.get(name);
    if (!column) throw new SqlRenderError(`Table \`${table}\` has no key column \`${name}\``);
    return column;
  });
}

/**
 * An idempotent bit set: `npcflag = npcflag | 2`. The bit and the key are written straight into the
 * statement rather than through a column codec, so both are checked to be plain unsigned integers.
 */
function renderSetFlag(s: Extract<PatchStatement, { kind: 'set-flag' }>): string {
  if (!Number.isInteger(s.bit) || s.bit < 0) {
    throw new SqlRenderError(`Flag bit for \`${s.table}\`.\`${s.column}\` must be a non-negative integer`);
  }
  const conds = Object.entries(s.key).map(([column, value]) => {
    if (!UNSIGNED_INT_TEXT.test(value)) {
      throw new SqlRenderError(`Key \`${column}\` for \`${s.table}\` must be a non-negative integer, got ${JSON.stringify(value)}`);
    }
    return `${ident(column)} = ${value}`;
  });
  if (conds.length === 0) throw new SqlRenderError(`Refusing UPDATE on \`${s.table}\` without key columns`);
  return `UPDATE ${ident(s.table)} SET ${ident(s.column)} = ${ident(s.column)} | ${s.bit} WHERE ${conds.join(' AND ')};`;
}

/**
 * `UPDATE t SET … WHERE key AND onlyIf;` with every value through the column codec. The guard keeps a
 * re-applied patch from overwriting a value somebody set on purpose since.
 */
function renderUpdate(s: Extract<PatchStatement, { kind: 'update' }>, schema: SchemaInfo): string {
  const byName = new Map(columnsOf(schema, s.table).map((c) => [c.name, c]));
  const column = (name: string) => {
    const c = byName.get(name);
    if (!c) throw new SqlRenderError(`Table \`${s.table}\` has no column \`${name}\``);
    return c;
  };
  const sets = Object.entries(s.set).map(([name, value]) => `${ident(name)} = ${renderValue(column(name), value)}`);
  const keys = Object.entries(s.key).map(([name, value]) => `${ident(name)} = ${renderValue(column(name), value)}`);
  const guards = Object.entries(s.onlyIf ?? {}).map(([name, value]) => `${ident(name)} = ${renderValue(column(name), value)}`);
  if (sets.length === 0) throw new SqlRenderError(`Refusing UPDATE on \`${s.table}\` with nothing to set`);
  if (keys.length === 0) throw new SqlRenderError(`Refusing UPDATE on \`${s.table}\` without key columns`);
  return `UPDATE ${ident(s.table)} SET ${sets.join(', ')} WHERE ${[...keys, ...guards].join(' AND ')};`;
}

/**
 * One statement as a single SQL string.
 *
 * Exported so a caller that executes the patch gets exactly one string per statement, rather than
 * having to cut the rendered file up again: a text value may contain newlines and semicolons.
 */
export function renderStatement(s: PatchStatement, schema: SchemaInfo): string {
  if (s.kind === 'delete') {
    return renderDelete(s.table, keyColumnsOf(schema, s.table, Object.keys(s.key)), s.key);
  }
  if (s.kind === 'set-flag') return renderSetFlag(s);
  if (s.kind === 'update') return renderUpdate(s, schema);
  return renderInsert(s.table, columnsOf(schema, s.table), s.row);
}

/** The patch as a `.sql` file: a header, then the deletes, the flag updates, the other updates and the inserts. */
export function renderPatch(
  statements: readonly PatchStatement[],
  schema: SchemaInfo,
  meta: PatchMeta,
): string {
  const header = [
    `-- ACORE Quest Creator ${meta.toolVersion}`,
    `-- Quest: ${meta.questId}`,
    `-- Schema: ${schema.hash}`,
    `-- Generated: ${meta.date}`,
  ];

  const deletes: string[] = [];
  const flags: string[] = [];
  const updates: string[] = [];
  const inserts: string[] = [];
  for (const s of statements) {
    const block = s.kind === 'delete' ? deletes : s.kind === 'set-flag' ? flags : s.kind === 'update' ? updates : inserts;
    block.push(renderStatement(s, schema));
  }

  const blocks = [header, deletes, flags, updates, inserts].filter((b) => b.length > 0).map((b) => b.join('\n'));
  return `${blocks.join('\n\n')}\n`;
}

/** `<date>_<nn>_quest_<id>_<slug>.sql`, sortable and safe on every platform. */
export function patchFileName(args: { date: string; sequence: number; questId: number; title: string }): string {
  const slug =
    args.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, SLUG_MAX)
      .replace(/_+$/, '') || 'untitled';
  return `${args.date}_${String(args.sequence).padStart(2, '0')}_quest_${args.questId}_${slug}.sql`;
}
