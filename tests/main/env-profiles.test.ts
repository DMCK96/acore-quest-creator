import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { profileFromEnv, seedEnvProfiles } from '../../src/main/env-profiles';
import { openStore, type SecretBox, type Store } from '../../src/main/store/store';

const box: SecretBox = {
  encrypt: (s) => Uint8Array.from(Buffer.from(s, 'utf8')),
  decrypt: (b) => Buffer.from(b).toString('utf8'),
};
const dirs: string[] = [];
let store: Store | undefined;
afterEach(() => { store?.close(); store = undefined; dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })); });
const open = () => { const d = mkdtempSync(join(tmpdir(), 'acqc-')); dirs.push(d); store = openStore(join(d, 'app.sqlite'), box); return store; };

const world = { ACQC_WORLD_DB_HOST: 'h', ACQC_WORLD_DB_USER: 'u', ACQC_WORLD_DB_PASSWORD: 'pw', ACQC_WORLD_DB_DATABASE: 'acore_world' };

describe('profileFromEnv', () => {
  it('reads a role, defaulting the port', () => {
    expect(profileFromEnv(world, 'world')).toEqual({ name: 'World (.env)', role: 'world', host: 'h', port: 3306, user: 'u', database: 'acore_world', password: 'pw' });
  });
  it('is null unless host, user and database are all set', () => {
    expect(profileFromEnv({ ...world, ACQC_WORLD_DB_HOST: '' }, 'world')).toBeNull();
    expect(profileFromEnv(world, 'dev')).toBeNull();
  });
  it('rejects a port that is not a number', () => {
    expect(() => profileFromEnv({ ...world, ACQC_WORLD_DB_PORT: 'abc' }, 'world')).toThrow(/PORT/);
  });
});

describe('seedEnvProfiles', () => {
  it('saves the profile once and updates it on later launches', () => {
    const s = open();
    const id = seedEnvProfiles(s, world);
    expect(id).not.toBeNull();
    expect(seedEnvProfiles(s, { ...world, ACQC_WORLD_DB_PASSWORD: 'new' })).toBe(id);
    expect(s.profiles.list()).toHaveLength(1);
    expect(s.profiles.getWithPassword(id!).password).toBe('new');
  });
  it('returns null when the environment has no world profile', () => {
    expect(seedEnvProfiles(open(), {})).toBeNull();
  });
});
