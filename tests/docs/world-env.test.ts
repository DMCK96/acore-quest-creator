import { describe, expect, it } from 'vitest';
import { worldDbFromEnv } from './world-env';

const full = [
  '# comment line',
  'ACQC_WORLD_DB_HOST=127.0.0.1',
  'ACQC_WORLD_DB_PORT=3307',
  'ACQC_WORLD_DB_USER=acore',
  'ACQC_WORLD_DB_PASSWORD="p@ss word"',
  'ACQC_WORLD_DB_DATABASE=acore_world',
  String.raw`ACQC_WORLD_DB_DBC_DIR=C:\AzerothCore\data\dbc`,
  'ACQC_WORLD_DB_CLIENT_DIR=',
  '',
].join('\n');

describe('worldDbFromEnv', () => {
  it('reads the world DB settings', () => {
    expect(worldDbFromEnv(full)).toEqual({
      host: '127.0.0.1',
      port: 3307,
      user: 'acore',
      password: 'p@ss word',
      database: 'acore_world',
      dbcDir: String.raw`C:\AzerothCore\data\dbc`,
    });
  });

  it('keeps Windows backslash paths exactly as written', () => {
    const env = worldDbFromEnv(full);
    expect(env.dbcDir).toBe(String.raw`C:\AzerothCore\data\dbc`);
    expect(env.dbcDir).toContain('\\');
  });

  it('leaves empty optional folders out', () => {
    expect(worldDbFromEnv(full)).not.toHaveProperty('clientDir');
  });

  it('defaults the port to 3306', () => {
    expect(worldDbFromEnv(full.replace('ACQC_WORLD_DB_PORT=3307\n', '')).port).toBe(3306);
  });

  it('handles CRLF line endings', () => {
    expect(worldDbFromEnv(full.replace(/\n/g, '\r\n')).database).toBe('acore_world');
  });

  it('refuses when the host is missing', () => {
    expect(() => worldDbFromEnv(full.replace('ACQC_WORLD_DB_HOST=127.0.0.1', 'ACQC_WORLD_DB_HOST='))).toThrow(
      'Set ACQC_WORLD_DB_HOST and ACQC_WORLD_DB_DATABASE in .env to take screenshots',
    );
  });

  it('refuses when the database is missing', () => {
    expect(() => worldDbFromEnv(full.replace('ACQC_WORLD_DB_DATABASE=acore_world\n', ''))).toThrow(
      'Set ACQC_WORLD_DB_HOST and ACQC_WORLD_DB_DATABASE in .env to take screenshots',
    );
  });
});
