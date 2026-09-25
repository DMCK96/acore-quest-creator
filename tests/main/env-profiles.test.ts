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
    expect(profileFromEnv(world, 'world')).toEqual({ name: 'World (.env)', role: 'world', host: 'h', port: 3306, user: 'u', database: 'acore_world', password: 'pw', dbcDir: '', clientDir: '', exportDir: '' });
  });
  it('reads the world server data folder', () => {
    expect(profileFromEnv({ ...world, ACQC_WORLD_DB_DBC_DIR: ' /srv/data ' }, 'world')?.dbcDir).toBe('/srv/data');
  });
  it('reads the game client folder for the world role only', () => {
    const withClient = { ACQC_WORLD_DB_HOST: 'h', ACQC_WORLD_DB_USER: 'u', ACQC_WORLD_DB_DATABASE: 'acore_world', ACQC_WORLD_DB_CLIENT_DIR: ' E:/Games/WoW ' };
    expect(profileFromEnv(withClient, 'world')?.clientDir).toBe('E:/Games/WoW');
    const dev = { ACQC_DEV_DB_HOST: 'h', ACQC_DEV_DB_USER: 'u', ACQC_DEV_DB_DATABASE: 'd', ACQC_DEV_DB_CLIENT_DIR: '/x' };
    expect(profileFromEnv(dev, 'dev')?.clientDir).toBe('');
  });
  it('reads the export folder for the world role only', () => {
    expect(profileFromEnv({ ...world, ACQC_WORLD_DB_EXPORT_DIR: ' /srv/patches ' }, 'world')?.exportDir).toBe('/srv/patches');
    const dev = { ACQC_DEV_DB_HOST: 'h', ACQC_DEV_DB_USER: 'u', ACQC_DEV_DB_DATABASE: 'd', ACQC_DEV_DB_EXPORT_DIR: '/x' };
    expect(profileFromEnv(dev, 'dev')?.exportDir).toBe('');
  });
  it('is null unless host, user and database are all set', () => {
    expect(profileFromEnv({ ...world, ACQC_WORLD_DB_HOST: '' }, 'world')).toBeNull();
    expect(profileFromEnv(world, 'dev')).toBeNull();
  });
  it('rejects a port that is not a number, or is out of range', () => {
    expect(() => profileFromEnv({ ...world, ACQC_WORLD_DB_PORT: 'abc' }, 'world')).toThrow(/PORT/);
    expect(() => profileFromEnv({ ...world, ACQC_WORLD_DB_PORT: '70000' }, 'world')).toThrow(/PORT/);
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
  it('keeps edits made in the app until the .env values themselves change', () => {
    const s = open();
    const id = seedEnvProfiles(s, world)!;
    s.profiles.save({ id, name: 'World (.env)', role: 'world', host: 'edited', port: 3307, user: 'u', database: 'acore_world', clientDir: 'E:/WoW' });
    expect(seedEnvProfiles(s, world)).toBe(id);
    expect(s.profiles.getWithPassword(id)).toMatchObject({ host: 'edited', port: 3307, clientDir: 'E:/WoW', password: 'pw' });
    seedEnvProfiles(s, { ...world, ACQC_WORLD_DB_HOST: 'moved' });
    expect(s.profiles.getWithPassword(id)).toMatchObject({ host: 'moved', port: 3306 });
    expect(s.profiles.list()).toHaveLength(1);
  });
  it('returns null when the environment has no world profile', () => {
    expect(seedEnvProfiles(open(), {})).toBeNull();
  });
});
