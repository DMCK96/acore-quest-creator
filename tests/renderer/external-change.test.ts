import { describe, expect, it, vi } from 'vitest';
import { createAppStore } from '../../src/renderer/state/app-store';
import { makeMockApi, okv, sampleOpen, nodeOf } from './mock-api';

const drift = { missingTables: [], unregistered: [], missingColumns: [], typeMismatches: [] };
const form = { name: 'w', role: 'world' as const, host: 'h', port: 1, user: 'u', database: 'd', password: 'p' };
const label = 'Claude: edit quest 60001';
const change = (over: Record<string, unknown>) => ({
  step: { id: 1, label, kind: 'quest', where: { questId: 60001 } }, direction: 'redo',
  quests: [], positions: false, world: null, entities: null, name: false, skipped: [],
  history: { steps: [{ id: 1, label, kind: 'quest', where: { questId: 60001 } }], current: 1, saved: 0 }, ...over,
}) as any;

async function openStore(over: Record<string, any> = {}) {
  const open = sampleOpen({ questId: 60001 });
  const api = makeMockApi({
    saveProfile: async () => okv({ id: 1, ...form }), connect: async () => okv({ profileId: 1, schemaHash: 'h', drift, blocking: false }),
    listNodes: vi.fn(async () => okv([nodeOf({ questId: 60001 })])), openQuest: async () => okv(open), validate: async () => okv([]), ...over,
  });
  const store = createAppStore(api, { saveDelayMs: 50 });
  await store.getState().connect(form);
  await store.getState().openQuest(60001);
  return { store, api, open };
}

describe('a change made from the main process (Claude)', () => {
  it('shows the open quest as Claude left it, with the history and a note naming the step', async () => {
    const { store, open } = await openStore();
    const aggregate = { ...open.aggregate, values: { ...open.aggregate.values, 'quest_template.LogTitle': 'Kobold Camp Cleanup' } };
    await store.getState().applyExternalChange(change({ quests: [{ questId: 60001, aggregate }] }));
    expect(store.getState().open!.aggregate.values['quest_template.LogTitle']).toBe('Kobold Camp Cleanup');
    expect(store.getState().history.steps.map((s) => s.label)).toEqual([label]);
    expect(store.getState().historyNote?.text).toBe(label);
  });

  it('does not send the window\'s old copy of the quest back over the change', async () => {
    const { store, api, open } = await openStore();
    await store.getState().applyExternalChange(change({ quests: [{ questId: 60001, aggregate: open.aggregate }] }));
    await new Promise((r) => setTimeout(r, 120));
    expect(api.updateQuest).not.toHaveBeenCalled();
  });

  it('closes the editor when the change removed the open quest', async () => {
    const { store } = await openStore();
    await store.getState().applyExternalChange(change({ quests: [{ questId: 60001, aggregate: null }], positions: true }));
    expect(store.getState().open).toBeNull();
  });

  it('reloads the canvas when quests came or went', async () => {
    const { store, api } = await openStore();
    vi.mocked(api.listNodes).mockClear();
    await store.getState().applyExternalChange(change({ positions: true, quests: [] }));
    expect(api.listNodes).toHaveBeenCalled();
  });

  it('keeps an edit typed while the change is being applied, on top of it', async () => {
    const { store, open } = await openStore();
    const aggregate = { ...open.aggregate, values: { ...open.aggregate.values, 'quest_template.LogTitle': 'From Claude' } };
    const pending = store.getState().applyExternalChange(change({ quests: [{ questId: 60001, aggregate }] }));
    store.getState().setValue('quest_template.QuestLevel', 12);
    await pending;
    const values = store.getState().open!.aggregate.values;
    expect(values['quest_template.LogTitle']).toBe('From Claude');
    expect(values['quest_template.QuestLevel']).toBe(12);
  });
});

describe('a connection made from the main process (Claude)', () => {
  const summary = { profileId: 1, schemaHash: 'h', drift, blocking: false, serverData: null, clientDir: null, client: null } as any;

  it('leaves the login screen for the app, as a connect from the window would', async () => {
    const api = makeMockApi();
    const store = createAppStore(api, { saveDelayMs: 50 });
    expect(store.getState().screen).toBe('connect');
    await store.getState().adoptConnection(summary);
    expect(store.getState().screen).toBe('pick');
    expect(store.getState().summary).toBe(summary);
    expect(store.getState().connection).toBe(1);
  });

  it('stays on the login screen and says why when the database cannot be worked with', async () => {
    const store = createAppStore(makeMockApi(), { saveDelayMs: 50 });
    await store.getState().adoptConnection({ ...summary, blocking: true, drift: { ...drift, missingTables: ['quest_template'] } });
    expect(store.getState().screen).toBe('connect');
    expect(store.getState().error).toMatch(/quest_template/);
  });
});
