import { describe, it, expect, vi } from 'vitest';
import { createAppStore } from '../../src/renderer/state/app-store';
import { EMPTY_WORLD } from '../../src/core/world/layer';
import { makeMockApi, okv } from './mock-api';

const group = { id: 7, name: 'Dailies', map: 0, maxActive: 1, origin: { kind: 'new' }, event: null, removed: false, members: [{ type: 'quest', questId: 1 }, { type: 'quest', questId: 2 }] } as any;

describe('rotation tags follow the world layer', () => {
  it('a layer whose groups changed (a revert in Project changes) reloads the quest pools', async () => {
    const pools = vi.fn(async () => okv([{ id: 7, name: 'Dailies', questIds: [1, 2], daily: true }] as any));
    const store = createAppStore(makeMockApi({ questPools: pools }), { saveDelayMs: 0 });
    store.getState().setLayer({ ...EMPTY_WORLD, groups: [group] });
    await vi.waitFor(() => expect(pools).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(store.getState().questPools).toHaveLength(1));
    pools.mockClear();
    store.getState().setLayer({ ...EMPTY_WORLD, groups: [] });
    await vi.waitFor(() => expect(pools).toHaveBeenCalledTimes(1));
    // A layer with the same groups does not
    pools.mockClear();
    store.getState().setLayer({ ...EMPTY_WORLD, groups: [] });
    expect(pools).not.toHaveBeenCalled();
  });
});
