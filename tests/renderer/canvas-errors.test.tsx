// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '../../src/renderer/state/app-store';
import { CanvasHome } from '../../src/renderer/views/CanvasHome';
import { makeMockApi, okv, errv, sampleOpen, nodeOf } from './mock-api';

const drift = { missingTables: [], unregistered: [], missingColumns: [], typeMismatches: [], blockingTables: [] };
const rec = { id: 1, name: 'w', role: 'world' as const, host: 'h', port: 1, user: 'u', database: 'd' };
const form = { name: 'w', role: 'world' as const, host: 'h', port: 1, user: 'u', database: 'd', password: 'p' };

async function canvas(over: Record<string, any> = {}) {
  const api = makeMockApi({
    saveProfile: async () => okv(rec),
    connect: async () => okv({ profileId: 1, schemaHash: 'h', drift, blocking: false }),
    listNodes: async () => okv([nodeOf()]),
    openQuest: async () => okv(sampleOpen()),
    newQuest: async () => okv(sampleOpen({ questId: 60003 })),
    validate: async () => okv([]),
    ...over,
  });
  const store = createAppStore(api, { saveDelayMs: 0 });
  await store.getState().connect(form);
  const view = render(<CanvasHome store={store} />);
  return { api, store, view };
}

/**
 * Everything past the connection screen used to swallow `store.error`: the canvas rendered it
 * nowhere, so a full ID range, a dropped connection or a failed save simply did nothing visible.
 */
describe('CanvasHome error reporting', () => {
  it('shows an exhausted ID range instead of doing nothing', async () => {
    const { store } = await canvas({
      newQuest: async () => errv('RANGE_EXHAUSTED', 'Every ID between 60000 and 60000 is taken.'),
    });
    await screen.findAllByTestId('quest-node');
    await store.getState().newQuest();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Every ID between 60000 and 60000 is taken.');
  });

  it('can be dismissed, and a later success clears it by itself', async () => {
    let fail = true;
    const { store } = await canvas({
      newQuest: async () => (fail ? errv('CONNECTION', 'Cannot connect to MySQL at h:1') : okv(sampleOpen({ questId: 60003 }))),
    });
    await store.getState().newQuest();
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();

    await store.getState().newQuest();
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot connect to MySQL at h:1');
    fail = false;
    await store.getState().newQuest();
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('shows a failed node removal', async () => {
    const { store } = await canvas({ removeNode: async () => errv('UNKNOWN', 'The draft store is locked.') });
    await store.getState().removeNode(60001);
    expect(await screen.findByRole('alert')).toHaveTextContent('The draft store is locked.');
  });

  it('shows a failed draft save while the editor drawer is open', async () => {
    const { store } = await canvas({ saveDraft: async () => errv('UNKNOWN', 'Could not write the draft.') });
    await store.getState().openQuest(60001);
    expect(await screen.findByRole('complementary', { name: 'Quest editor' })).toBeInTheDocument();
    store.getState().setValue('quest_template.LogTitle', 'Edited');
    await store.getState().flushSave();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not write the draft.');
  });

  it('reports a failed drag/viewport flush instead of dropping it', async () => {
    const { store } = await canvas({ moveNodes: async () => errv('UNKNOWN', 'Could not save the layout.') });
    await screen.findAllByTestId('quest-node');
    store.getState().moveNode(60001, 10, 20);
    await store.getState().flushMoves();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the layout.');
  });
});
