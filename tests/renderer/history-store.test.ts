import { describe, it, expect, vi } from 'vitest';
import { createAppStore } from '../../src/renderer/state/app-store';
import { makeMockApi, okv, errv, sampleOpen, emptyHistoryResult } from './mock-api';

const drift = { missingTables: [], unregistered: [], missingColumns: [], typeMismatches: [] };
const form = { name: 'w', role: 'world' as const, host: 'h', port: 1, user: 'u', database: 'd', password: 'p' };
const list = (n: number) => ({ steps: Array.from({ length: n }, (_, i) => ({ id: i + 1, label: `S${i + 1}`, kind: 'quest' as const, where: null })), current: n, saved: 0 });

async function connected(over: Record<string, any> = {}) {
  const api = makeMockApi({ saveProfile: async () => okv({ id: 1, ...form }), connect: async () => okv({ profileId: 1, schemaHash: 'h', drift, blocking: false }), ...over });
  const store = createAppStore(api, { saveDelayMs: 50 });
  await store.getState().connect(form);
  return { api, store };
}

describe('undo and redo in the store', () => {
  it('sends a quest edit typed a moment ago before undoing, so the undo takes it back', async () => {
    const { api, store } = await connected();
    await store.getState().openQuest(60001);
    store.getState().setValue('quest_template.LogTitle', 'Typed just now');
    await store.getState().undo();
    const edit = vi.mocked(api.updateQuest).mock.invocationCallOrder[0]!;
    const undo = vi.mocked(api.historyUndo).mock.invocationCallOrder[0]!;
    expect(edit).toBeLessThan(undo);
  });

  it('sends queued graph moves before undoing', async () => {
    const { api, store } = await connected();
    store.getState().moveNode(60001, 10, 20);
    await store.getState().undo();
    expect(vi.mocked(api.moveNodes).mock.invocationCallOrder[0]!).toBeLessThan(vi.mocked(api.historyUndo).mock.invocationCallOrder[0]!);
  });

  it('does not undo when the pending edit could not be saved', async () => {
    const { api, store } = await connected({ updateQuest: async () => errv('UNKNOWN', 'disk full') });
    await store.getState().openQuest(60001);
    store.getState().setValue('quest_template.LogTitle', 'x');
    await store.getState().undo();
    expect(api.historyUndo).not.toHaveBeenCalled();
    expect(store.getState().error).toBe('disk full');
  });

  it('puts the returned quest into the open quest, without marking it as an unsent edit', async () => {
    const base = sampleOpen();
    const restored = { ...base.aggregate, values: { ...base.aggregate.values, 'quest_template.LogTitle': 'Before' } };
    const { store } = await connected({ historyUndo: async () => okv({ ...emptyHistoryResult, step: { id: 2, label: 'Title of X', kind: 'quest', where: { questId: base.questId } }, quests: [{ questId: base.questId, aggregate: restored }], history: list(1) }) });
    await store.getState().openQuest(base.questId);
    await store.getState().undo();
    expect(store.getState().open!.aggregate).toEqual(restored);
    expect(store.getState().dirty).toBe(false);
    expect(store.getState().historyNote).toEqual({ text: 'Undid: Title of X', where: { questId: base.questId }, skipped: [] });
    expect(store.getState().history).toEqual(list(1));
  });

  it('closes the open quest when the undo took it out of the project', async () => {
    const base = sampleOpen();
    const { store } = await connected({ historyUndo: async () => okv({ ...emptyHistoryResult, step: { id: 1, label: 'New quest', kind: 'quest', where: null }, quests: [{ questId: base.questId, aggregate: null }], positions: true }) });
    await store.getState().openQuest(base.questId);
    await store.getState().undo();
    expect(store.getState()).toMatchObject({ open: null, screen: 'pick' });
  });

  it('reloads the graph when positions changed, and hands a changed world layer on with a new count', async () => {
    const layer = { spawns: [], routes: [], added: [], movements: [] };
    const { api, store } = await connected({ historyRedo: async () => okv({ ...emptyHistoryResult, direction: 'redo', step: { id: 1, label: 'Moved Guard', kind: 'world', where: null }, positions: true, world: layer }) });
    const nodes = vi.mocked(api.listNodes).mock.calls.length;
    await store.getState().redo();
    expect(vi.mocked(api.listNodes).mock.calls.length).toBeGreaterThan(nodes);
    expect(store.getState().worldLayer).toEqual({ layer, seq: 1 });
    expect(store.getState().historyNote!.text).toBe('Redid: Moved Guard');
    await store.getState().redo();
    expect(store.getState().worldLayer!.seq).toBe(2);
  });

  it('says nothing when there was nothing to undo, and passes skipped parts to the note', async () => {
    const { store } = await connected();
    await store.getState().undo();
    expect(store.getState().historyNote).toBeNull();
    const { store: s2 } = await connected({ historyRedo: async () => okv({ ...emptyHistoryResult, direction: 'redo', step: { id: 1, label: 'Placed Mailbox', kind: 'world', where: null }, skipped: ['Could not redo: spawn 9 is now in the database'] }) });
    await s2.getState().redo();
    expect(s2.getState().historyNote!.skipped).toEqual(['Could not redo: spawn 9 is now in the database']);
  });

  it('jumps to a step', async () => {
    const { api, store } = await connected();
    await store.getState().jumpTo(3);
    expect(api.historyJump).toHaveBeenCalledWith(3);
  });

  it('runs a step: begin, the work, the pending quest edit, then end, even when the work fails', async () => {
    const { api, store } = await connected();
    await store.getState().openQuest(60001);
    await store.getState().historyStep(async () => { store.getState().setValue('quest_template.LogTitle', 'In the step'); }, 'Paste 2 spawns');
    const order = ['historyBegin', 'updateQuest', 'historyEnd'].map((m) => vi.mocked((api as any)[m]).mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(api.historyBegin).toHaveBeenCalledWith('Paste 2 spawns', undefined);
    await expect(store.getState().historyStep(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(api.historyEnd).toHaveBeenCalledTimes(2);
  });

  it('takes the list the main process pushes', async () => {
    const { store } = await connected();
    store.getState().setHistory(list(2));
    expect(store.getState().history.current).toBe(2);
  });
});

describe('a new quest from an NPC', () => {
  it('is one step: the new quest, its giver and ender, and its place in the chain', async () => {
    const { api, store } = await connected({ newQuest: vi.fn(async () => okv(sampleOpen({ questId: 60003 }))) });
    await store.getState().openQuest(60001);
    await store.getState().newQuestFrom({ entry: 1423, name: 'Guard' }, 60001);
    expect(api.historyBegin).toHaveBeenCalledWith('Next quest from Guard', undefined);
    const begin = vi.mocked(api.historyBegin).mock.invocationCallOrder[0]!;
    const made = vi.mocked(api.newQuest).mock.invocationCallOrder[0]!;
    const sent = vi.mocked(api.updateQuest).mock.invocationCallOrder.at(-1)!;
    const end = vi.mocked(api.historyEnd).mock.invocationCallOrder[0]!;
    expect([begin < made, made < sent, sent < end]).toEqual([true, true, true]);
    const values = vi.mocked(api.updateQuest).mock.calls.at(-1)![0].values;
    expect(values['creature_queststarter']).toEqual([{ id: 1423 }]);
    expect(values['creature_questender']).toEqual([{ id: 1423 }]);
    expect(values['quest_template_addon.PrevQuestID']).toBe(60001);
    expect(store.getState().open!.questId).toBe(60003);
  });

  it('names a first quest from the NPC, and touches nothing when no quest was made', async () => {
    const { api, store } = await connected({ newQuest: vi.fn(async () => okv(sampleOpen({ questId: 60003 }))) });
    await store.getState().newQuestFrom({ entry: 1423, name: 'Guard' }, null);
    expect(api.historyBegin).toHaveBeenCalledWith('New quest from Guard', undefined);
    const { api: failing, store: s2 } = await connected({ newQuest: vi.fn(async () => errv('UNKNOWN', 'no')) });
    await s2.getState().newQuestFrom({ entry: 1423, name: 'Guard' }, null);
    expect(failing.updateQuest).not.toHaveBeenCalled();
  });
});
