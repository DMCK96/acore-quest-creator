import { describe, it, expect } from 'vitest';
import type { ProfileRecord } from '@shared/ipc';
import { draftFromProfiles, draftToSaves, validateDraft, worldChanged, devChanged, emptyDev, type ConnectionDraft } from '../../src/renderer/connection/draft';

const rec = (over: Partial<ProfileRecord>): ProfileRecord => ({
  id: 1, name: 'World', role: 'world', host: 'h', port: 3306, user: 'u', database: 'd', dbcDir: '', clientDir: '', lastConnectedAt: null, ...over,
});

describe('draftFromProfiles', () => {
  it('is an empty world draft on port 3306 with no dev when nothing is saved', () => {
    expect(draftFromProfiles([])).toEqual({
      world: { host: '', port: '3306', user: '', database: '', password: '', dbcDir: '', clientDir: '' },
      dev: null,
    });
  });
  it('takes the world profile that connected last, the newest dev, and never a password', () => {
    const d = draftFromProfiles([
      rec({ id: 1, host: 'old', lastConnectedAt: '2026-09-01T00:00:00.000Z' }),
      rec({ id: 2, host: 'recent', dbcDir: '/data', clientDir: 'E:/WoW', lastConnectedAt: '2026-09-20T00:00:00.000Z' }),
      rec({ id: 3, host: 'never' }),
      rec({ id: 4, role: 'dev', name: 'Dev (.env)', host: 'dev1' }),
      rec({ id: 5, role: 'dev', name: 'Dev', host: 'dev2', port: 3307 }),
    ]);
    expect(d.world).toEqual({ id: 2, name: 'World', host: 'recent', port: '3306', user: 'u', database: 'd', password: '', dbcDir: '/data', clientDir: 'E:/WoW' });
    expect(d.dev).toEqual({ id: 5, name: 'Dev', host: 'dev2', port: '3307', user: 'u', database: 'd', password: '' });
  });
  it('falls back to the newest world row when none has connected', () => {
    expect(draftFromProfiles([rec({ id: 1, host: 'a' }), rec({ id: 7, host: 'b' })]).world.id).toBe(7);
  });
});

describe('draftToSaves', () => {
  const original = draftFromProfiles([rec({ id: 1 }), rec({ id: 2, role: 'dev', name: 'Dev' })]);

  it('omits a blank password on a saved profile and keeps its name', () => {
    const { world, dev, removeDevId } = draftToSaves(original, original);
    expect(world).toEqual({ id: 1, name: 'World', role: 'world', host: 'h', port: 3306, user: 'u', database: 'd', dbcDir: '', clientDir: '' });
    expect(world).not.toHaveProperty('password');
    expect(dev).toEqual({ id: 2, name: 'Dev', role: 'dev', host: 'h', port: 3306, user: 'u', database: 'd' });
    expect(removeDevId).toBeNull();
  });
  it('sends a typed password, and a blank one on a new profile, and names new rows World and Dev', () => {
    const draft: ConnectionDraft = {
      world: { host: ' h ', port: ' 3306 ', user: 'u', database: 'd', password: 'pw', dbcDir: ' /data ', clientDir: '' },
      dev: { ...emptyDev(), host: 'dh', user: 'du', database: 'dd' },
    };
    const { world, dev } = draftToSaves(draft, draftFromProfiles([]));
    expect(world).toEqual({ name: 'World', role: 'world', host: 'h', port: 3306, user: 'u', database: 'd', password: 'pw', dbcDir: '/data', clientDir: '' });
    expect(dev).toEqual({ name: 'Dev', role: 'dev', host: 'dh', port: 3306, user: 'du', database: 'dd', password: '' });
  });
  it('removes the dev row the user removed', () => {
    expect(draftToSaves({ ...original, dev: null }, original)).toMatchObject({ dev: null, removeDevId: 2 });
  });
  it('remove then re-add inserts a new dev row', () => {
    const readded = { ...original, dev: { ...emptyDev(), host: 'x', user: 'u', database: 'd' } };
    const { dev, removeDevId } = draftToSaves(readded, original);
    expect(dev).not.toHaveProperty('id');
    expect(removeDevId).toBe(2);
  });
});

describe('validateDraft', () => {
  const ok: ConnectionDraft = { world: { host: 'h', port: '3306', user: 'u', database: 'd', password: '', dbcDir: '', clientDir: '' }, dev: null };
  it('passes a complete draft with an empty password', () => {
    expect(validateDraft(ok)).toEqual({});
  });
  it('requires host, user and database, in the world and dev sections', () => {
    const errors = validateDraft({ world: { ...ok.world, host: ' ', user: '', database: '' }, dev: emptyDev() });
    expect(errors).toEqual({
      'conn-host': 'Host is required', 'conn-user': 'User is required', 'conn-database': 'Database is required',
      'conn-dev-host': 'Host is required', 'conn-dev-user': 'User is required', 'conn-dev-database': 'Database is required',
    });
  });
  it('port validation', () => {
    const port = (p: string) => validateDraft({ ...ok, world: { ...ok.world, port: p } })['conn-port'];
    expect(port(' 3306 ')).toBeUndefined();
    for (const bad of ['0', '-1', '3.5', 'abc', '']) expect(port(bad)).toBe('Port must be a whole number above 0');
  });
});

describe('worldChanged / devChanged', () => {
  const original = draftFromProfiles([rec({ id: 1 }), rec({ id: 2, role: 'dev' })]);
  it('sees a folder or password edit as a world change, and a dev edit as a dev change only', () => {
    expect(worldChanged(original, original)).toBe(false);
    expect(worldChanged({ ...original, world: { ...original.world, clientDir: 'E:/WoW' } }, original)).toBe(true);
    expect(worldChanged({ ...original, world: { ...original.world, password: 'new' } }, original)).toBe(true);
    const devEdit = { ...original, dev: { ...original.dev!, host: 'other' } };
    expect(worldChanged(devEdit, original)).toBe(false);
    expect(devChanged(devEdit, original)).toBe(true);
    expect(devChanged({ ...original, dev: null }, original)).toBe(true);
  });
});
