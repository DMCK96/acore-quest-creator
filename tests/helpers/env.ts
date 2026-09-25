import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type Env = Readonly<Record<string, string | undefined>>;

// Tests read the same `.env` the app reads when run from source, read literally so Windows paths
// keep their backslashes. Variables already set (in the shell, or by CI) win.
const repoEnv = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env');
if (existsSync(repoEnv)) process.loadEnvFile(repoEnv);

const set = (value: string | undefined): string | undefined => (value?.trim() ? value.trim() : undefined);

/** The fork's `data/sql` folder: `ACQC_AC_SQL_DIR`, else the `sql` folder beside the server's `dbc/`'s parent. */
export function acSqlDirFrom(env: Env): string {
  const given = set(env.ACQC_AC_SQL_DIR);
  if (given) return given;
  const dbc = set(env.ACQC_WORLD_DB_DBC_DIR);
  if (dbc) return join(dbc, '..', 'sql');
  throw new Error("Set ACQC_AC_SQL_DIR, or ACQC_WORLD_DB_DBC_DIR in .env, to run the tests that read the fork's base SQL");
}

/** The server's data folder, the one holding `dbc/`, `maps/` and `mmaps/`. */
export function serverDataDirFrom(env: Env): string {
  const dbc = set(env.ACQC_WORLD_DB_DBC_DIR);
  if (!dbc) throw new Error('Set ACQC_WORLD_DB_DBC_DIR in .env to run the tests that read server data');
  return join(dbc, '..');
}

/** The game client folder, the one holding Wow.exe. */
export function clientDirFrom(env: Env): string {
  const dir = set(env.ACQC_WORLD_DB_CLIENT_DIR);
  if (!dir) throw new Error('Set ACQC_WORLD_DB_CLIENT_DIR in .env to run the tests that read the game client');
  return dir;
}

export const acSqlDir = (): string => acSqlDirFrom(process.env);
export const serverDataDir = (): string => serverDataDirFrom(process.env);
export const clientDir = (): string => clientDirFrom(process.env);

export function mysqlUrl(): string {
  const url = process.env.ACQC_TEST_MYSQL_URL;
  if (!url) throw new Error('ACQC_TEST_MYSQL_URL is not set; integration tests do not skip');
  return url;
}
