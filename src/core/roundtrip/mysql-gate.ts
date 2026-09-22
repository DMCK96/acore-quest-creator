import mysql from 'mysql2/promise';
import type { Connection, Field } from 'mysql2/promise';
import type { RawRow, SchemaInfo } from '../db/types';
import type { Registry } from '../registry/types';
import { ident, renderInsert } from '../sql/render';
import type { Snapshot } from '../model/aggregate';
import { compareTables } from './compare';
import { keyColumnsByTable } from './apply';
import type { FidelityReport } from './verify';

export interface MysqlScratch {
  reset(): Promise<void>;
  load(tables: Record<string, RawRow[]>, schema: SchemaInfo): Promise<void>;
  apply(sql: string): Promise<void>;
  readAll(tables: readonly string[]): Promise<Record<string, RawRow[]>>;
  drop(): Promise<void>;
}

export interface MysqlScratchOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  worldDatabase: string;
  tables: readonly string[];
}

/** Thrown when a scratch operation targets a schema that is not one of ours. */
export class InvalidScratchSchemaError extends Error {
  constructor(schema: string) {
    super(`Refusing to operate on schema "${schema}": scratch schemas must start with "acqc_scratch_"`);
    this.name = 'InvalidScratchSchemaError';
  }
}

const SCRATCH_PREFIX = 'acqc_scratch_';

function randomSuffix(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

class MysqlScratchImpl implements MysqlScratch {
  constructor(
    private readonly conn: Connection,
    private readonly schema: string,
    private readonly tables: readonly string[],
  ) {
    if (!schema.startsWith(SCRATCH_PREFIX)) throw new InvalidScratchSchemaError(schema);
  }

  async reset(): Promise<void> {
    for (const table of this.tables) {
      await this.conn.query(`TRUNCATE TABLE ${ident(this.schema)}.${ident(table)}`);
    }
  }

  async load(tables: Record<string, RawRow[]>, schema: SchemaInfo): Promise<void> {
    for (const [table, rows] of Object.entries(tables)) {
      const columns = schema.tables[table];
      if (!columns || rows.length === 0) continue;
      const statements = rows.map((row) => renderInsert(table, columns, row));
      await this.conn.query(`USE ${ident(this.schema)}; ${statements.join(' ')}`);
    }
  }

  async apply(sql: string): Promise<void> {
    await this.conn.query(`USE ${ident(this.schema)}; ${sql}`);
  }

  async readAll(tables: readonly string[]): Promise<Record<string, RawRow[]>> {
    const out: Record<string, RawRow[]> = {};
    for (const table of tables) {
      const [rows] = await this.conn.query(`SELECT * FROM ${ident(this.schema)}.${ident(table)}`);
      out[table] = (rows as RawRow[]).map((r) => ({ ...r }));
    }
    return out;
  }

  async drop(): Promise<void> {
    if (!this.schema.startsWith(SCRATCH_PREFIX)) throw new InvalidScratchSchemaError(this.schema);
    await this.conn.query(`DROP DATABASE IF EXISTS ${ident(this.schema)}`);
    await this.conn.end();
  }
}

export async function createMysqlScratch(opts: MysqlScratchOptions): Promise<MysqlScratch> {
  const schema = `${SCRATCH_PREFIX}${randomSuffix()}`;
  const conn = await mysql.createConnection({
    host: opts.host,
    port: opts.port,
    user: opts.user,
    password: opts.password,
    multipleStatements: true,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    decimalNumbers: false,
    typeCast: (field: Field, _next: () => unknown) => field.string(),
  });

  await conn.query(`CREATE DATABASE ${ident(schema)}`);
  for (const table of opts.tables) {
    await conn.query(`CREATE TABLE ${ident(schema)}.${ident(table)} LIKE ${ident(opts.worldDatabase)}.${ident(table)}`);
  }

  return new MysqlScratchImpl(conn, schema, opts.tables);
}

export async function verifyPatchInMysql(
  scratch: MysqlScratch,
  args: {
    snapshot: Snapshot;
    patchSql: string;
    expected: Record<string, RawRow[]>;
    schema: SchemaInfo;
    registry: Registry;
    applyTwice?: boolean;
  },
): Promise<FidelityReport> {
  const { snapshot, patchSql, expected, schema, registry, applyTwice = false } = args;
  await scratch.reset();
  await scratch.load(snapshot.tables, schema);
  await scratch.apply(patchSql);
  if (applyTwice) await scratch.apply(patchSql);

  const tables = Object.keys(expected);
  const actual = await scratch.readAll(tables);
  const keys = keyColumnsByTable(registry);
  const differences = compareTables(expected, actual, keys);
  return differences.length === 0 ? { ok: true } : { ok: false, differences };
}
