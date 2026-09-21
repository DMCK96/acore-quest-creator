import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ColumnInfo } from '@core/db/types';
import { acSqlDir } from './env';

const STRING = String.raw`'(?:[^'\\]|\\[\s\S]|'')*'`;
const TYPE_RE = new RegExp(
  String.raw`^(\w+)(?:\((?:${STRING}|[^)'])*\))?(?:\s+(?:unsigned|signed|zerofill))*`,
  'i',
);
const TOKEN_RE = new RegExp(String.raw`${STRING}|[^\s,']+`, 'g');
const ESCAPES: Record<string, string> = { n: '\n', r: '\r', t: '\t', '0': '\0', Z: '\x1a', b: '\b' };

function unquote(token: string): string {
  return token.slice(1, -1).replace(/''|\\([\s\S])/g, (m, c: string | undefined) => {
    if (m === "''") return "'";
    return ESCAPES[c as string] ?? (c as string);
  });
}

const ident = (s: string): string => s.replace(/``/g, '`');

/** Parses one `CREATE TABLE` statement (mysqldump style) into ordered column metadata. */
export function parseCreateTable(sql: string): ColumnInfo[] {
  const lines = sql.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((l) => /^\s*CREATE TABLE\b/i.test(l));
  if (start < 0) throw new Error('parseCreateTable: no CREATE TABLE statement found');

  const columns: ColumnInfo[] = [];
  const keyNames: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith(')')) break;
    const col = /^ {2}`((?:[^`]|``)+)`\s+(.*?),?\s*$/.exec(line);
    if (col) {
      const rest = col[2];
      const typeMatch = TYPE_RE.exec(rest);
      if (!typeMatch) throw new Error(`parseCreateTable: cannot read type in: ${line.trim()}`);
      const columnType = typeMatch[0];
      let nullable = true;
      let def: string | null = null;
      const tokens = rest.slice(columnType.length).match(TOKEN_RE) ?? [];
      for (let i = 0; i < tokens.length; i++) {
        const upper = tokens[i].toUpperCase();
        if (upper === 'NOT' && tokens[i + 1]?.toUpperCase() === 'NULL') {
          nullable = false;
          i++;
        } else if (upper === 'DEFAULT') {
          const value = tokens[++i] ?? '';
          def = value.startsWith("'") ? unquote(value) : value.toUpperCase() === 'NULL' ? null : value;
        } else if (upper === 'COMMENT') {
          i++;
        }
      }
      columns.push({
        name: ident(col[1]),
        dataType: typeMatch[1].toLowerCase(),
        columnType,
        nullable,
        default: def,
        ordinal: columns.length + 1,
        isKey: false,
      });
      continue;
    }
    const pk = /^\s*PRIMARY KEY\s*\((.*)\)/i.exec(line);
    if (pk) for (const m of pk[1].matchAll(/`((?:[^`]|``)+)`/g)) keyNames.push(ident(m[1]));
  }
  for (const c of columns) c.isKey = keyNames.includes(c.name);
  return columns;
}

/** Reads `<acSqlDir>/base/db_world/<table>.sql` for each table. */
export function loadFork(tables: string[]): Record<string, ColumnInfo[]> {
  const out: Record<string, ColumnInfo[]> = {};
  for (const table of tables) {
    const file = join(acSqlDir(), 'base', 'db_world', `${table}.sql`);
    out[table] = parseCreateTable(readFileSync(file, 'utf8'));
  }
  return out;
}
