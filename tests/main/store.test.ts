import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openStore, type SecretBox, type Store } from '../../src/main/store/store';

const box: SecretBox = {
  encrypt: (s) => Uint8Array.from(Buffer.from(s, 'utf8').map((b) => b ^ 0x5a)),
  decrypt: (b) => Buffer.from(Uint8Array.from(b).map((x) => x ^ 0x5a)).toString('utf8'),
};
const dirs: string[] = [];
let store: Store | undefined;
afterEach(() => { store?.close(); store = undefined; dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'acqc-')); dirs.push(d); return d; };


describe('store', () => {
  it('encrypts profile passwords at rest and decrypts on request', () => {
    const dir = tmp(); const file = join(dir, 'app.sqlite');
    store = openStore(file, box);
    const rec = store.profiles.save({ name: 'local', role: 'world', host: 'h', port: 3306, user: 'ro', database: 'acore_world', password: 'hunter2-secret' });
    expect(rec).not.toHaveProperty('password');
    expect(store.profiles.getWithPassword(rec.id).password).toBe('hunter2-secret');
    store.close(); store = undefined;
    expect(readFileSync(file).includes(Buffer.from('hunter2-secret'))).toBe(false);
  });

  it('updates a profile in place and removes it', () => {
    store = openStore(':memory:', box);
    const a = store.profiles.save({ name: 'a', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p' });
    const b = store.profiles.save({ id: a.id, name: 'renamed', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p2' });
    expect(b.id).toBe(a.id);
    expect(store.profiles.list()).toHaveLength(1);
    expect(store.profiles.getWithPassword(a.id).password).toBe('p2');
    store.profiles.save({ id: a.id, name: 'kept', role: 'world', host: 'h', port: 1, user: 'u', database: 'd' });
    expect(store.profiles.getWithPassword(a.id)).toMatchObject({ name: 'kept', password: 'p2' });
    expect(store.profiles.list()[0]!.dbcDir).toBe('');
    store.profiles.save({ id: a.id, name: 'kept', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', dbcDir: '/srv/data' });
    expect(store.profiles.getWithPassword(a.id)).toMatchObject({ dbcDir: '/srv/data', password: 'p2' });
    expect(store.profiles.list()[0]!.clientDir).toBe('');
    store.profiles.save({ id: a.id, name: 'kept', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', dbcDir: '/srv/data', clientDir: 'E:/Games/WoW' });
    expect(store.profiles.getWithPassword(a.id)).toMatchObject({ dbcDir: '/srv/data', clientDir: 'E:/Games/WoW', password: 'p2' });
    store.profiles.remove(a.id);
    expect(store.profiles.list()).toEqual([]);
  });

  it('keeps recent projects newest first, updating an entry in place', () => {
    store = openStore(':memory:', box);
    const t = (m: number) => new Date(Date.UTC(2026, 8, 23, 10, m));
    store.recent.touch('C:\\a.aqc', 'A', t(1));
    store.recent.touch('C:\\b.aqc', 'B', t(2));
    store.recent.touch('C:\\a.aqc', 'A renamed', t(3));
    expect(store.recent.list()).toEqual([
      { path: 'C:\\a.aqc', name: 'A renamed', openedAt: t(3).toISOString() },
      { path: 'C:\\b.aqc', name: 'B', openedAt: t(2).toISOString() },
    ]);
    store.recent.forget('C:\\b.aqc');
    store.recent.forget('C:\\missing.aqc');
    expect(store.recent.list().map((r) => r.path)).toEqual(['C:\\a.aqc']);
  });

  it('keeps only the ten most recent projects', () => {
    store = openStore(':memory:', box);
    for (let i = 0; i < 12; i++) store.recent.touch(`C:\\p${i}.aqc`, `P${i}`, new Date(Date.UTC(2026, 8, 23, 10, i)));
    const paths = store.recent.list().map((r) => r.path);
    expect(paths).toHaveLength(10);
    expect(paths[0]).toBe('C:\\p11.aqc');
    expect(paths).not.toContain('C:\\p0.aqc');
    expect(paths).not.toContain('C:\\p1.aqc');
  });

  it('holds no project content: the draft and project tables are gone', () => {
    const dir = tmp(); const file = join(dir, 'app.sqlite');
    store = openStore(file, box);
    store.profiles.save({ name: 'kept', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p' });
    store.close(); store = undefined;
    const raw = new Database(file, { readonly: true });
    const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite_%'").all().map((r: any) => r.name).sort();
    raw.close();
    expect(tables).toEqual(['connection_profiles', 'recent_projects']);
  });
});
