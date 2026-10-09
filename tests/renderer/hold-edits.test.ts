import { describe, expect, it, vi } from 'vitest';
import { createAppStore } from '../../src/renderer/state/app-store';
import { makeMockApi, okv, sampleOpen, nodeOf } from './mock-api';

const drift = { missingTables: [], unregistered: [], missingColumns: [], typeMismatches: [] };
const form = { name: 'w', role: 'world' as const, host: 'h', port: 1, user: 'u', database: 'd', password: 'p' };
const label = 'AI: edit quest 60001';
const change = (over: Record<string, unknown>) => ({
  step: { id: 1, label, kind: 'quest', where: { questId: 60001 } }, direction: 'redo',
  quests: [], positions: false, world: null, entities: null, name: false, skipped: [],
  history: { steps: [{ id: 1, label, kind: 'quest', where: { questId: 60001 } }], current: 1, saved: 0 }, ...over,
}) as any;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function openStore() {
  const open = sampleOpen({ questId: 60001 });
  const api = makeMockApi({
    saveProfile: async () => okv({ id: 1, ...form }), connect: async () => okv({ profileId: 1, schemaHash: 'h', drift, blocking: false }),
    listNodes: vi.fn(async () => okv([nodeOf({ questId: 60001 })])), openQuest: async () => okv(open), validate: async () => okv([]),
  });
  const store = createAppStore(api, { saveDelayMs: 20 });
  await store.getState().connect(form);
  await store.getState().openQuest(60001);
  return { store, api, open };
}

describe('quest edits typed while an AI write is on its way', () => {
  it('are not sent from the older copy, and are shown and sent on top of the change', async () => {
    const { store, api, open } = await openStore();
    store.getState().holdEdits(true);
    store.getState().setValue('quest_template.QuestLevel', 12);
    await wait(80);
    expect(api.updateQuest).not.toHaveBeenCalled();

    const aggregate = { ...open.aggregate, values: { ...open.aggregate.values, 'quest_template.LogTitle': 'From the AI' } };
    await store.getState().applyExternalChange(change({ quests: [{ questId: 60001, aggregate }] }));
    store.getState().holdEdits(false);
    await wait(80);

    const sent = vi.mocked(api.updateQuest).mock.calls.map((c) => (c[0] as any).values);
    expect(sent.length).toBeGreaterThan(0);
    for (const values of sent) {
      expect(values['quest_template.LogTitle']).toBe('From the AI');
      expect(values['quest_template.QuestLevel']).toBe(12);
    }
    expect(store.getState().open!.aggregate.values['quest_template.QuestLevel']).toBe(12);
  });

  it('are sent once the write is over even when it changed nothing here', async () => {
    const { store, api } = await openStore();
    store.getState().holdEdits(true);
    store.getState().setValue('quest_template.QuestLevel', 9);
    await wait(60);
    expect(api.updateQuest).not.toHaveBeenCalled();
    store.getState().holdEdits(false);
    await wait(60);
    expect(vi.mocked(api.updateQuest).mock.calls.at(-1)![0].values['quest_template.QuestLevel']).toBe(9);
  });

  it('are sent as usual when no write is on its way', async () => {
    const { store, api } = await openStore();
    store.getState().setValue('quest_template.QuestLevel', 7);
    await wait(80);
    expect(api.updateQuest).toHaveBeenCalledTimes(1);
  });
});

describe('the editor while an AI write is on its way', () => {
  it('says so while the hold lasts, and no longer once it is over', async () => {
    const { store } = await openStore();
    expect(store.getState().aiWriting).toBe(false);
    store.getState().holdEdits(true);
    expect(store.getState().aiWriting).toBe(true);
    store.getState().holdEdits(false);
    expect(store.getState().aiWriting).toBe(false);
  });
});
