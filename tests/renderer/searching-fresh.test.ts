import { describe, expect, it, vi } from 'vitest';
import { createAppStore } from '../../src/renderer/state/app-store';
import { searchingFresh } from '../../src/renderer/state/project-entities';
import { makeMockApi, okv } from './mock-api';

describe('searching the project\'s entities', () => {
  it('sends an NPC edit still on the debounce before searching, so the new name is found', async () => {
    const order: string[] = [];
    const api = makeMockApi({
      allocateIds: vi.fn(async () => okv([11000231])),
      putProjectEntities: vi.fn(async (next: any) => { order.push(`put ${next.npcs[0]?.name ?? ''}`); return okv(true); }),
      searchEntities: vi.fn(async (_kind: string, text: string) => { order.push(`search ${text}`); return okv([]); }),
    });
    const store = createAppStore(api, { saveDelayMs: 60_000 });
    await store.getState().createEntity('npc', {});
    const now = store.getState().entities;
    store.getState().setEntities({ ...now, npcs: [{ ...now.npcs[0]!, name: 'Scout Hela' }] });
    await searchingFresh(api, () => store.getState().flushEntities()).searchEntities('creature', 'Scout');
    expect(order).toEqual(['put ', 'put Scout Hela', 'search Scout']);
  });
});
