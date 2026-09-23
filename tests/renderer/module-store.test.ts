import { describe, it, expect, vi } from 'vitest';
import { createAppStore } from '../../src/renderer/state/app-store';
import { makeMockApi, okv, sampleOpen } from './mock-api';

const open = sampleOpen({
  aggregate: { questId: 60001, isNew: false, readOnly: [], sharedItems: {},
    values: { 'quest_template.LogTitle': 'Wolves', 'quest_template.TimeAllowed': 900 } },
});

describe('module editor store', () => {
  it('opens a quest as a preview, then edits it', async () => {
    const api = makeMockApi({ openQuest: vi.fn(async () => okv(open)) });
    const store = createAppStore(api, { saveDelayMs: 0 });
    await store.getState().openQuest(60001);
    expect(store.getState().screen).toBe('preview');
    expect(api.updateQuest).not.toHaveBeenCalled();
    store.getState().editQuest();
    expect(store.getState().screen).toBe('edit');
    expect(store.getState().openPanel).toBeNull();
  });

  it('starts a new quest straight in the editor', async () => {
    const store = createAppStore(makeMockApi(), { saveDelayMs: 0 });
    await store.getState().newQuest();
    expect(store.getState().screen).toBe('edit');
  });

  it('adds a module and opens its panel, once', async () => {
    const store = createAppStore(makeMockApi({ openQuest: vi.fn(async () => okv(open)) }), { saveDelayMs: 0 });
    await store.getState().openQuest(60001);
    store.getState().editQuest();
    store.getState().addModule('chain');
    store.getState().addModule('chain');
    expect(store.getState().addedModules).toEqual(['chain']);
    expect(store.getState().openPanel).toBe('chain');
  });

  it('removing a module resets its fields through setValue', async () => {
    const api = makeMockApi({ openQuest: vi.fn(async () => okv(open)) });
    const store = createAppStore(api, { saveDelayMs: 0 });
    await store.getState().openQuest(60001);
    store.getState().editQuest();
    store.getState().setOpenPanel('timer');
    store.getState().removeModule('timer');
    expect(store.getState().open?.aggregate.values['quest_template.TimeAllowed']).toBe(0);
    expect(store.getState().openPanel).toBeNull();
    await store.getState().flushSave();
    expect(api.updateQuest).toHaveBeenCalled();
  });

  it('the changes view sends an edit still waiting on the debounce before it compares', async () => {
    const api = makeMockApi({ openQuest: vi.fn(async () => okv(open)) });
    const store = createAppStore(api, { saveDelayMs: 10_000 });
    await store.getState().openQuest(60001);
    store.getState().editQuest();
    store.getState().setValue('quest_template.LogTitle', 'Wolves!');
    await store.getState().loadPreview();
    const saved = vi.mocked(api.updateQuest).mock.invocationCallOrder[0];
    expect(saved).toBeDefined();
    expect(vi.mocked(api.previewChanges).mock.invocationCallOrder[0]).toBeGreaterThan(saved);
  });

  it('going back to the chain sends an edit still waiting on the debounce', async () => {
    const api = makeMockApi({ openQuest: vi.fn(async () => okv(open)) });
    const store = createAppStore(api, { saveDelayMs: 10_000 });
    await store.getState().openQuest(60001);
    store.getState().editQuest();
    store.getState().setValue('quest_template.LogTitle', 'Wolves!');
    await store.getState().backToChain();
    expect(api.updateQuest).toHaveBeenCalled();
    expect(store.getState().screen).toBe('preview');
    expect(store.getState().open?.questId).toBe(60001);
  });
});
