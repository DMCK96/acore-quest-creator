// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { createAppStore } from '../../src/renderer/state/app-store';
import { makeMockApi, okv, sampleOpen } from './mock-api';

const profileRec = { id: 1, name: 'local', role: 'world' as const, host: 'h', port: 3306, user: 'u', database: 'd' };
const drift = { missingTables: [], unregistered: [], missingColumns: [], typeMismatches: [], blockingTables: [] };
const form = { name: 'local', role: 'world' as const, host: 'h', port: 3306, user: 'u', database: 'd', password: 'p' };

describe('switching module panels', () => {
  it('sends the pending edit straight away, so the next panel sees it', async () => {
    const updateQuest = vi.fn(async () => okv(true as const));
    const api = makeMockApi({
      saveProfile: async () => okv(profileRec),
      connect: async () => okv({ profileId: 1, schemaHash: 'h', drift, blocking: false, serverData: null }),
      openQuest: async () => okv(sampleOpen()),
      updateQuest,
    });
    // A save delay far longer than the test: only the panel switch can send the edit in time.
    const store = createAppStore(api, { saveDelayMs: 60_000 });
    await store.getState().connect(form);
    await store.getState().openQuest(60001);
    store.getState().setOpenPanel('entities');
    store.getState().setValue('quest_template.LogTitle', 'Edited');
    expect(updateQuest).not.toHaveBeenCalled();
    store.getState().setOpenPanel('giver');
    await waitFor(() => expect(updateQuest).toHaveBeenCalledTimes(1));
    expect((updateQuest.mock.calls[0] as unknown as [{ values: Record<string, unknown> }])[0].values['quest_template.LogTitle']).toBe('Edited');
  });
});
