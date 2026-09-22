import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mysql from 'mysql2/promise';
import { openMysqlDevDb, DevDbExecuteError } from '../../src/core/db/mysql-dev-db';
import { mysqlUrl } from '../helpers/env';

const u = new URL(mysqlUrl());
const conn = { host: u.hostname, port: Number(u.port || 3306), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password) };
const schema = `acqc_scratch_dev_${Math.random().toString(36).slice(2, 8)}`;
let admin: mysql.Connection;
beforeAll(async () => {
  admin = await mysql.createConnection(conn);
  await admin.query(`CREATE DATABASE \`${schema}\``);
  await admin.query(`CREATE TABLE \`${schema}\`.t (id INT PRIMARY KEY, v VARCHAR(20))`);
});
afterAll(async () => { await admin.query(`DROP DATABASE \`${schema}\``); await admin.end(); });

describe('MysqlDevDb', () => {
  it('applies all statements in one transaction', async () => {
    const dev = await openMysqlDevDb({ ...conn, database: schema });
    await dev.execute(["INSERT INTO `t` (`id`, `v`) VALUES (1, 'a');", "INSERT INTO `t` (`id`, `v`) VALUES (2, 'b\\'c');"]);
    await dev.close();
    const [rows] = await admin.query(`SELECT id, v FROM \`${schema}\`.t ORDER BY id`);
    expect(rows).toEqual([{ id: 1, v: 'a' }, { id: 2, v: "b'c" }]);
  });
  it('rolls back everything and names the failing statement when one fails', async () => {
    const dev = await openMysqlDevDb({ ...conn, database: schema });
    const err = await dev.execute(["INSERT INTO `t` (`id`, `v`) VALUES (10, 'x');", "INSERT INTO `t` (`id`, `v`) VALUES (1, 'dup');"]).catch((e) => e);
    await dev.close();
    expect(err).toBeInstanceOf(DevDbExecuteError);
    expect(err.statementIndex).toBe(1);
    const [rows] = await admin.query(`SELECT COUNT(*) AS n FROM \`${schema}\`.t WHERE id = 10`);
    expect(rows).toEqual([{ n: 0 }]);
  });
});
