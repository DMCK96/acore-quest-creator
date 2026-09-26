// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createAppStore } from '../../src/renderer/state/app-store';
import { draftFromProfiles, emptyDev } from '../../src/renderer/connection/draft';
import type { ConnectSummary } from '@shared/ipc';
import type { SchemaDiff } from '@core/schema/diff';
import { makeMockApi, okv, errv, sampleOpen } from './mock-api';

const drift = { missingTables: [], forbiddenTables: [], unregistered: [], missingColumns: [], typeMismatches: [] } as unknown as SchemaDiff;
const summary = (profileId = 1, blocking = false): ConnectSummary => ({ profileId, schemaHash: 'h', drift, blocking, serverData: null, clientDir: null, client: null });
const rec = (id: number, role: 'world' | 'dev') => ({ id, name: role === 'world' ? 'World' : 'Dev', role, host: 'h', port: 3306, user: 'u', database: 'd', dbcDir: '', clientDir: '', exportDir: '', lastConnectedAt: null });

describe('saveConnection', () => {
  it('saves world then dev, removes a removed dev, reloads profiles, and returns the world id', async () => {
    const calls: string[] = [];
    const api = makeMockApi({
      saveProfile: async (p) => { calls.push(`save ${p.role}`); return okv(rec(p.role === 'world' ? 1 : 9, p.role)); },
      deleteProfile: async (id) => { calls.push(`delete ${id}`); return okv(null); },
      listProfiles: async () => { calls.push('list'); return okv([rec(1, 'world'), rec(9, 'dev')]); },
    });
    const store = createAppStore(api);
    const original = draftFromProfiles([rec(1, 'world'), rec(2, 'dev')]);
    const draft = { ...original, dev: { ...emptyDev(), host: 'x', user: 'u', database: 'd' } };
    expect(await store.getState().saveConnection(draft, original)).toMatchObject({ ok: true, worldId: 1, saved: { world: { id: 1 }, dev: { id: 9 } } });
    expect(calls).toEqual(['save world', 'save dev', 'delete 2', 'list']);
    expect(store.getState().hasDevProfile).toBe(true);
  });
  it('stops at the first failure and returns its message without touching the store error', async () => {
    const api = makeMockApi({ saveProfile: async () => errv('VALIDATION', 'bad port') });
    const store = createAppStore(api);
    const original = draftFromProfiles([]);
    expect(await store.getState().saveConnection(original, original)).toEqual({ ok: false, error: 'bad port', saved: null, original: null });
    expect(api.listProfiles).not.toHaveBeenCalled();
    expect(store.getState().error).toBeNull();
  });

  it('says the world details were saved when the dev ones fail, and hands back the saved world row', async () => {
    const api = makeMockApi({
      saveProfile: async (p) => (p.role === 'world' ? okv(rec(1, 'world')) : errv('VALIDATION', 'Secret storage is unavailable')),
      listProfiles: async () => okv([rec(1, 'world')]),
    });
    const store = createAppStore(api);
    const original = draftFromProfiles([]);
    const draft = {
      world: { ...original.world, host: 'h', user: 'u', database: 'd' },
      dev: { ...emptyDev(), host: 'x', user: 'u', database: 'd', password: 'dpw' },
    };
    const result = await store.getState().saveConnection(draft, original);
    expect(result).toMatchObject({
      ok: false,
      error: 'The world database was saved, but the dev database was not: Secret storage is unavailable',
      saved: { world: { id: 1 }, dev: { host: 'x', password: 'dpw' } },
      original: { world: { id: 1 }, dev: null },
    });
    expect(api.listProfiles).toHaveBeenCalled();
  });
});

describe('reconnect', () => {
  async function editing() {
    const api = makeMockApi({ connect: vi.fn(async (id: number) => okv(summary(id))), openQuest: async () => okv(sampleOpen()) });
    const store = createAppStore(api);
    await store.getState().connectProfile(1);
    await store.getState().openQuest(60001);
    return { api, store };
  }
  it('connects, closes the open quest, and returns null', async () => {
    const { api, store } = await editing();
    expect(await store.getState().reconnect(2)).toBeNull();
    expect(api.connect).toHaveBeenLastCalledWith(2);
    expect(store.getState()).toMatchObject({ screen: 'pick', open: null, error: null, summary: { profileId: 2 } });
  });
  it('leaves everything as it was when the connect fails', async () => {
    const { api, store } = await editing();
    vi.mocked(api.connect).mockResolvedValueOnce(errv('CONNECTION', 'Access denied for user'));
    const before = store.getState();
    expect(await store.getState().reconnect(2)).toBe('Access denied for user');
    expect(store.getState()).toMatchObject({ screen: before.screen, open: before.open, summary: { profileId: 1 }, error: null });
  });
  it('refuses to reconnect while an edit cannot be saved, keeping the quest and the reason', async () => {
    const { api, store } = await editing();
    vi.mocked(api.updateQuest).mockResolvedValue(errv('VALIDATION', 'The project file could not be written'));
    store.getState().setValue('quest_template.LogTitle', 'Changed');
    expect(await store.getState().reconnect(2)).toBe('The project file could not be written');
    expect(api.connect).not.toHaveBeenCalledWith(2);
    expect(store.getState().open).not.toBeNull();
    expect(store.getState().dirty).toBe(true);
  });
  it('reloads the canvas and starts a new connection epoch after reconnecting', async () => {
    const { api, store } = await editing();
    const epoch = store.getState().connection;
    vi.mocked(api.listNodes).mockClear();
    await store.getState().reconnect(2);
    expect(api.listNodes).toHaveBeenCalled();
    expect(store.getState().connection).toBe(epoch + 1);
  });
  it('drops what the last quest read from the old database', async () => {
    const { store } = await editing();
    store.setState({ preview: [], exportResult: { sql: 'x' } as never, pendingApply: { sql: 'x' }, appliedCount: 3, results: [{} as never] });
    await store.getState().reconnect(2);
    expect(store.getState()).toMatchObject({ preview: null, exportResult: null, exportError: null, pendingApply: null, appliedCount: null, results: [], issues: [] });
  });
  it('reconnect to a blocking database goes to the login screen', async () => {
    const { api, store } = await editing();
    vi.mocked(api.connect).mockResolvedValueOnce(okv({ ...summary(2, true), drift: { ...drift, missingTables: ['quest_offer_reward'] } }));
    expect(await store.getState().reconnect(2)).toBeNull();
    expect(store.getState().screen).toBe('connect');
    expect(store.getState().open).toBeNull();
    expect(store.getState().error).toMatch(/quest_offer_reward/);
  });
});
