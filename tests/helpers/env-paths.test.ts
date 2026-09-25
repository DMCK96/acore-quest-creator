import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { acSqlDirFrom, clientDirFrom, serverDataDirFrom } from './env';

const dbc = join('srv', 'acore', 'data', 'dbc');

describe('test folders from the environment', () => {
  it('takes the fork SQL folder as given', () => {
    expect(acSqlDirFrom({ ACQC_AC_SQL_DIR: join('x', 'sql'), ACQC_WORLD_DB_DBC_DIR: dbc })).toBe(join('x', 'sql'));
  });

  it('finds the SQL folder beside the server data folder', () => {
    expect(acSqlDirFrom({ ACQC_WORLD_DB_DBC_DIR: dbc })).toBe(join('srv', 'acore', 'data', 'sql'));
  });

  it('names what to set when neither is there', () => {
    expect(() => acSqlDirFrom({})).toThrow('Set ACQC_AC_SQL_DIR, or ACQC_WORLD_DB_DBC_DIR in .env, to run the tests that read the fork\'s base SQL');
  });

  it('takes the server data folder as the one above dbc/', () => {
    expect(serverDataDirFrom({ ACQC_WORLD_DB_DBC_DIR: dbc })).toBe(join('srv', 'acore', 'data'));
    expect(() => serverDataDirFrom({})).toThrow('Set ACQC_WORLD_DB_DBC_DIR in .env');
  });

  it('takes the game client folder from the connection setting', () => {
    expect(clientDirFrom({ ACQC_WORLD_DB_CLIENT_DIR: join('games', 'wow') })).toBe(join('games', 'wow'));
    expect(() => clientDirFrom({ ACQC_WORLD_DB_CLIENT_DIR: '' })).toThrow('Set ACQC_WORLD_DB_CLIENT_DIR in .env');
  });
});
