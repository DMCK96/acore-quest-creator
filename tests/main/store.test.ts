import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, DEFAULT_ID_RANGE, type SecretBox, type Store } from '../../src/main/store/store';

const box: SecretBox = {
  encrypt: (s) => Uint8Array.from(Buffer.from(s, 'utf8').map((b) => b ^ 0x5a)),
  decrypt: (b) => Buffer.from(Uint8Array.from(b).map((x) => x ^ 0x5a)).toString('utf8'),
};
const dirs: string[] = [];
let store: Store | undefined;
afterEach(() => { store?.close(); store = undefined; dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'acqc-')); dirs.push(d); return d; };

const aggregate = { questId: 60001, isNew: false, values: { 'quest_template.LogTitle': "It's \\ ok\r\n", 'creature_queststarter': [{ id: 1 }] }, readOnly: [], sharedItems: { '2000': [60002] } };
const snapshot = { questId: 60001, tables: { quest_template: [{ ID: '60001', LogTitle: null }] }, columnsRead: { quest_template: ['ID', 'LogTitle'] }, linkedContext: {}, schemaHash: 'abc' };

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
    store.profiles.remove(a.id);
    expect(store.profiles.list()).toEqual([]);
  });

  it('creates one default project with the default range and is idempotent', () => {
    store = openStore(':memory:', box);
    const p = store.projects.ensureDefault('C:\\out');
    expect(p).toMatchObject({ idRangeStart: DEFAULT_ID_RANGE.start, idRangeEnd: DEFAULT_ID_RANGE.end, outputDir: 'C:\\out' });
    expect(store.projects.ensureDefault('C:\\other').id).toBe(p.id);
    expect(store.projects.update({ ...p, outputDir: 'D:\\x' }).outputDir).toBe('D:\\x');
  });

  it('upserts drafts by project and quest, round-tripping JSON exactly', () => {
    store = openStore(':memory:', box);
    const p = store.projects.ensureDefault('C:\\out');
    const input = { projectId: p.id, questId: 60001, isNew: false, aggregate, snapshot, fidelity: { ok: true as const } };
    store.drafts.save(input);
    store.drafts.save({ ...input, aggregate: { ...aggregate, values: { ...aggregate.values, 'quest_template.LogTitle': 'v2' } } });
    const d = store.drafts.get(p.id, 60001)!;
    expect(store.drafts.list(p.id)).toHaveLength(1);
    expect(d.aggregate.values['quest_template.LogTitle']).toBe('v2');
    expect(d.snapshot).toEqual(snapshot);
    expect(d.fidelity).toEqual({ ok: true });
    expect(d.lastExportPath).toBeNull();
    store.drafts.markExported(p.id, 60001, 'C:\\out\\a.sql');
    expect(store.drafts.get(p.id, 60001)!.lastExportPath).toBe('C:\\out\\a.sql');
    expect(store.drafts.usedQuestIds(p.id)).toEqual([60001]);
    store.drafts.remove(p.id, 60001);
    expect(store.drafts.get(p.id, 60001)).toBeUndefined();
  });

  it('stores node positions, keeps them across draft edits, and moves them in bulk', () => {
    store = openStore(':memory:', box);
    const p = store.projects.ensureDefault('C:\\out');
    const input = { projectId: p.id, questId: 60001, isNew: false, aggregate, snapshot, fidelity: { ok: true as const } };
    expect(store.drafts.save(input)).toMatchObject({ x: 0, y: 0 });
    store.drafts.save({ ...input, x: 320, y: 180 });
    store.drafts.save({ ...input, aggregate: { ...aggregate, values: { ...aggregate.values, t: 1 } } });
    expect(store.drafts.get(p.id, 60001)).toMatchObject({ x: 320, y: 180 });
    store.drafts.save({ ...input, questId: 60002, aggregate: { ...aggregate, questId: 60002 } });
    store.drafts.setPositions(p.id, [{ questId: 60001, x: -50.5, y: 10 }, { questId: 99999, x: 1, y: 1 }]);
    expect(store.drafts.get(p.id, 60001)).toMatchObject({ x: -50.5, y: 10 });
    expect(store.drafts.get(p.id, 60002)).toMatchObject({ x: 0, y: 0 });
    expect(store.drafts.get(p.id, 99999)).toBeUndefined();
  });

  it('persists the canvas viewport on the project', () => {
    store = openStore(':memory:', box);
    const p = store.projects.ensureDefault('C:\\out');
    expect(p.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    store.projects.update({ ...p, viewport: { x: -120, y: 40, zoom: 0.6 } });
    expect(store.projects.get(p.id).viewport).toEqual({ x: -120, y: 40, zoom: 0.6 });
  });

  it('preserves unicode and control characters in draft text', () => {
    store = openStore(':memory:', box);
    const p = store.projects.ensureDefault('C:\\out');
    const text = "🙂 \0 \x1a \u2028 'q' \"d\" \\";
    store.drafts.save({ projectId: p.id, questId: 1, isNew: true, aggregate: { ...aggregate, values: { t: text } }, snapshot: null, fidelity: null });
    expect(store.drafts.get(p.id, 1)!.aggregate.values['t']).toBe(text);
  });
});
