import { describe, it, expect, vi } from 'vitest';
import { createAppStore } from '../../src/renderer/state/app-store';
import { makeMockApi, okv, errv, sampleOpen } from './mock-api';

const drift = { missingTables: [], unregistered: [], missingColumns: [], typeMismatches: [] };
const form = { name: 'w', role: 'world' as const, host: 'h', port: 1, user: 'u', database: 'd', password: 'p' };
const state = (over: Record<string, unknown> = {}) => ({ name: 'Northshire', filePath: 'C:\\w\\n.aqc', dirty: false, idRangeStart: 60000, idRangeEnd: 99999, outputDir: 'C:\\out', viewport: { x: 0, y: 0, zoom: 1 }, ...over });

async function connected(over: Record<string, any> = {}) {
  const api = makeMockApi({ saveProfile: async () => okv({ id: 1, ...form }), connect: async () => okv({ profileId: 1, schemaHash: 'h', drift, blocking: false }), projectState: async () => okv(state()), ...over });
  const store = createAppStore(api, { saveDelayMs: 50 });
  await store.getState().connect(form);
  return { api, store };
}

describe('project actions in the renderer store', () => {
  it('loads the project state with the nodes', async () => {
    const { store } = await connected();
    await store.getState().loadNodes();
    expect(store.getState().project).toMatchObject({ name: 'Northshire', dirty: false });
  });

  it('Save sends an edit typed a moment ago before saving', async () => {
    const { api, store } = await connected();
    await store.getState().openQuest(60001);
    store.getState().setValue('quest_template.LogTitle', 'Typed just now');
    await store.getState().saveProject();
    const edit = vi.mocked(api.updateQuest).mock.invocationCallOrder[0];
    const save = vi.mocked(api.saveProject).mock.invocationCallOrder[0];
    expect(edit).toBeLessThan(save);
    expect(api.updateQuest).toHaveBeenCalledWith(expect.objectContaining({ values: expect.objectContaining({ 'quest_template.LogTitle': 'Typed just now' }) }));
  });

  it('New closes the editor and moves to a new epoch; a cancelled New changes nothing', async () => {
    const { api, store } = await connected({ newProject: vi.fn().mockResolvedValueOnce(okv({ done: false })).mockResolvedValueOnce(okv({ done: true })) });
    await store.getState().openQuest(60001);
    await store.getState().newProject('Second');
    expect(store.getState().open).not.toBeNull();
    expect(store.getState().projectEpoch).toBe(0);
    await store.getState().newProject('Second');
    expect(api.newProject).toHaveBeenLastCalledWith('Second');
    expect(store.getState()).toMatchObject({ open: null, screen: 'pick', projectEpoch: 1 });
  });

  it('a failed open shows the reason and keeps the current project', async () => {
    const { store } = await connected({ openProject: async () => errv('PROJECT_FILE', 'This file is not an ACORE Quest Creator project.') });
    await store.getState().loadNodes();
    await store.getState().openProject('C:\\w\\bad.aqc');
    expect(store.getState().error).toBe('This file is not an ACORE Quest Creator project.');
    expect(store.getState().projectEpoch).toBe(0);
    expect(store.getState().project.name).toBe('Northshire');
  });

  it('refreshes the unsaved marker after moves, removals and exports', async () => {
    const projectState = vi.fn(async () => okv(state({ dirty: true })));
    const { store } = await connected({ projectState, openQuest: async () => okv(sampleOpen()) });
    store.getState().moveNode(60001, 5, 5);
    await store.getState().flushMoves();
    expect(store.getState().project.dirty).toBe(true);
    const before = projectState.mock.calls.length;
    await store.getState().removeNode(60001);
    await store.getState().openQuest(60001);
    await store.getState().exportQuest();
    expect(projectState.mock.calls.length).toBeGreaterThanOrEqual(before + 2);
  });

  it('restoring one recovery discards the others', async () => {
    const entries = [
      { id: 'a', name: 'A', recoveredFrom: null, writtenAt: '2026-09-23T15:00:00.000Z', questCount: 2, damaged: false },
      { id: 'b', name: 'B', recoveredFrom: null, writtenAt: '2026-09-23T14:00:00.000Z', questCount: 1, damaged: false },
    ];
    const { api, store } = await connected({ recoveries: vi.fn().mockResolvedValueOnce(okv(entries)).mockResolvedValue(okv([])) });
    await store.getState().loadRecoveries();
    expect(store.getState().recoveries).toHaveLength(2);
    await store.getState().restoreRecovery('a');
    expect(api.restoreRecovery).toHaveBeenCalledWith('a');
    expect(api.discardRecovery).toHaveBeenCalledWith('b');
    expect(store.getState()).toMatchObject({ recoveries: [], projectEpoch: 1 });
  });
});
