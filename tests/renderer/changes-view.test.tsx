// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { Difference } from '@core/roundtrip/compare';
import { createAppStore } from '../../src/renderer/state/app-store';
import { ChangesView } from '../../src/renderer/views/ChangesView';
import { makeMockApi, okv, sampleOpen } from './mock-api';

const profileRec = { id: 1, name: 'local', role: 'world' as const, host: 'h', port: 3306, user: 'u', database: 'd' };
const drift = { missingTables: [], unregistered: [], missingColumns: [], typeMismatches: [], blockingTables: [] };
const summary = { profileId: 1, schemaHash: 'h', drift, blocking: false };
const form = { name: 'local', role: 'world' as const, host: 'h', port: 3306, user: 'u', database: 'd', password: 'p' };

async function viewOf(preview: Difference[]) {
  const api = makeMockApi({
    saveProfile: async () => okv(profileRec),
    connect: async () => okv(summary),
    openQuest: async () => okv(sampleOpen()),
    previewChanges: async () => okv(preview),
  });
  const store = createAppStore(api, { saveDelayMs: 0 });
  await store.getState().connect(form);
  await store.getState().openQuest(60001);
  render(<ChangesView store={store} />);
  return store;
}

describe('ChangesView', () => {
  it('labels a removed row "Removed row" and an added row "New row"', async () => {
    await viewOf([
      { table: 'quest_poi_points', key: 'QuestID=60001,Idx1=0,Idx2=1', column: null, before: undefined, after: undefined, kind: 'removed' },
      { table: 'conditions', key: 'SourceEntry=60001', column: null, before: undefined, after: undefined, kind: 'added' },
    ]);
    await waitFor(() => expect(screen.getByText(/Removed row/)).toBeInTheDocument());
    expect(screen.getByText(/New row/)).toBeInTheDocument();
    expect(screen.getByText(/Removed row/).textContent).toContain('Idx2=1');
  });
});
