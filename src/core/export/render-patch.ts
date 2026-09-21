import type { ColumnInfo, SchemaInfo } from '../db/types';
import { SqlRenderError, ident, renderDelete, renderInsert } from '../sql/render';
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

/** The patch as a `.sql` file: a header, then the deletes, the flag updates and the inserts. */
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
  const inserts: string[] = [];
  for (const s of statements) {
    if (s.kind === 'delete') {
      deletes.push(renderDelete(s.table, keyColumnsOf(schema, s.table, Object.keys(s.key)), s.key));
    } else if (s.kind === 'set-flag') {
      flags.push(renderSetFlag(s));
    } else {
      inserts.push(renderInsert(s.table, columnsOf(schema, s.table), s.row));
    }
  }

  const blocks = [header, deletes, flags, inserts].filter((b) => b.length > 0).map((b) => b.join('\n'));
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
