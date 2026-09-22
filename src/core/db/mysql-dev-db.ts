import mysql from 'mysql2/promise';
import type { Connection } from 'mysql2/promise';
import type { DevDb } from './dev-db';

export interface MysqlDevDbOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/**
 * One statement of a patch was refused by the dev server, so the whole patch was rolled back.
 *
 * `statementIndex` is the zero-based position in the list handed to `execute`, which is the same
 * order the rendered patch has, so the UI can point at the line that failed.
 */
export class DevDbExecuteError extends Error {
  constructor(
    readonly statementIndex: number,
    readonly statement: string,
    reason: string,
    cause?: unknown,
  ) {
    super(`Statement ${statementIndex + 1} failed and the patch was rolled back: ${reason}`);
    this.name = 'DevDbExecuteError';
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

const reasonOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * A write-enabled connection to the dev database.
 *
 * Unlike the world connection this is a single connection, not a pool: a transaction only means
 * anything if every statement in it travels down the same wire.
 */
class MysqlDevDb implements DevDb {
  constructor(private readonly conn: Connection) {}

  async execute(statements: readonly string[]): Promise<void> {
    await this.conn.query('START TRANSACTION');
    let index = 0;
    try {
      for (; index < statements.length; index++) {
        await this.conn.query(statements[index]!);
      }
      // A failing COMMIT is reported against the last statement: that is the work being lost.
      index = Math.max(0, statements.length - 1);
      await this.conn.query('COMMIT');
    } catch (err) {
      // Rolling back is best effort: if the connection itself died there is nothing left to undo.
      await this.conn.query('ROLLBACK').catch(() => undefined);
      throw new DevDbExecuteError(index, statements[index] ?? '', reasonOf(err), err);
    }
  }

  async close(): Promise<void> {
    await this.conn.end();
  }
}

export async function openMysqlDevDb(opts: MysqlDevDbOptions): Promise<DevDb> {
  const conn = await mysql.createConnection({
    host: opts.host,
    port: opts.port,
    user: opts.user,
    password: opts.password,
    database: opts.database,
    // The patch arrives as separate statements; multi-statement queries stay off.
    multipleStatements: false,
    connectTimeout: 5_000,
  });
  return new MysqlDevDb(conn);
}
