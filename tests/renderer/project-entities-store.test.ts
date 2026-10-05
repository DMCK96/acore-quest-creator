// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppStore } from '../../src/renderer/state/app-store';
import { EMPTY_ENTITIES, newNpc } from '../../src/core/entities/model';
import { makeMockApi, okv } from './mock-api';

const hela = { ...newNpc(12000001), name: 'Hela' };
const historyResult = (entities: unknown) => okv({ step: null, direction: 'undo' as const, quests: [], positions: false, world: null, entities, name: false, skipped: [], history: { steps: [], current: 0, saved: 0 } });

afterEach(() => {
  vi.useRealTimers();
});

describe('the renderer\'s project store', () => {
  it('sets at once and sends after the debounce', async () => {
    vi.useFakeTimers();
    const api = makeMockApi({ putProjectEntities: vi.fn(async () => okv(true as const)) });
    const store = createAppStore(api, { saveDelayMs: 300 });
    store.getState().setEntities({ ...EMPTY_ENTITIES, npcs: [hela] });
    expect(store.getState().entities.npcs[0]!.name).toBe('Hela');
    expect(api.putProjectEntities).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(api.putProjectEntities).toHaveBeenCalledWith({ ...EMPTY_ENTITIES, npcs: [hela] });
  });

  it('sends a pending edit before an undo, then takes the store the undo left', async () => {
    const calls: string[] = [];
    const api = makeMockApi({
      putProjectEntities: vi.fn(async () => { calls.push('put'); return okv(true as const); }),
      historyUndo: vi.fn(async () => { calls.push('undo'); return historyResult(EMPTY_ENTITIES); }),
    });
    const store = createAppStore(api, { saveDelayMs: 10_000 });
    store.getState().setEntities({ ...EMPTY_ENTITIES, npcs: [hela] });
    const seq = store.getState().entitiesSeq;
    await store.getState().undo();
    expect(calls).toEqual(['put', 'undo']);
    expect(store.getState().entities).toEqual(EMPTY_ENTITIES);
    expect(store.getState().entitiesSeq).toBe(seq + 1);
  });

  it('creates an entity with a fresh id and no quest attached, and sends it now', async () => {
    const api = makeMockApi({ allocateIds: vi.fn(async () => okv([12000007])), putProjectEntities: vi.fn(async () => okv(true as const)) });
    const store = createAppStore(api, { saveDelayMs: 10_000 });
    const made = await store.getState().createEntity('npc', { name: 'Scout' });
    expect(made).toEqual({ entry: 12000007 });
    expect(api.allocateIds).toHaveBeenCalledWith('creature', 1);
    expect(api.putProjectEntities).toHaveBeenCalledTimes(1);
    expect(store.getState().entities.npcs[0]).toMatchObject({ entry: 12000007, name: 'Scout' });
    expect(store.getState().entities.npcs[0]).not.toHaveProperty('madeFor');
  });

  it('says why when no id could be had', async () => {
    const api = makeMockApi({ allocateIds: vi.fn(async () => okv([])) });
    const store = createAppStore(api, { saveDelayMs: 10 });
    expect(await store.getState().createEntity('object', {})).toEqual({ error: 'No free ID could be found.' });
    expect(store.getState().entities).toEqual(EMPTY_ENTITIES);
  });

  it('reads the store when it connects', async () => {
    const api = makeMockApi({ projectEntities: vi.fn(async () => okv({ ...EMPTY_ENTITIES, npcs: [hela] })) });
    const store = createAppStore(api, { saveDelayMs: 10 });
    await store.getState().connectProfile(1);
    expect(store.getState().entities.npcs.map((n) => n.name)).toEqual(['Hela']);
  });
});

describe('opening an older project', () => {
  it('says what moving its quests\' NPCs into the project kept', async () => {
    const api = makeMockApi({ openProject: vi.fn(async () => okv({ done: true, warnings: ['NPC 1 was in quests 2 and 3; the one from quest 2 was kept.'] })) });
    const store = createAppStore(api, { saveDelayMs: 10 });
    await store.getState().openProject('C:\p.aqc');
    expect(store.getState().error).toBe('NPC 1 was in quests 2 and 3; the one from quest 2 was kept.');
  });
});
