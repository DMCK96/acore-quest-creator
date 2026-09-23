// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '../../src/renderer/state/app-store';
import { QuestPreview } from '../../src/renderer/views/QuestPreview';
import { NamesProvider } from '../../src/renderer/state/names';
import { makeMockApi, okv, sampleOpen } from './mock-api';

const open = sampleOpen({
  issues: [{ severity: 'warning', code: 'NO_ENDER', fieldId: 'creature_questender', message: 'Nothing takes this quest back.' }],
  aggregate: { questId: 60001, isNew: false, readOnly: [], sharedItems: {}, values: {
    'quest_template.LogTitle': 'Wolves', 'quest_template.QuestLevel': 10,
    'quest_template.RequiredNpcOrGo': [{ target: { target: 'creature', id: 299 }, count: 10 }],
    'quest_template.TimeAllowed': 905,
  } },
});

async function mountPreview() {
  const api = makeMockApi({
    openQuest: vi.fn(async () => okv(open)),
    lookupNames: vi.fn(async (_k: string, ids: number[]) => okv(Object.fromEntries(ids.map((i) => [i, 'Diseased Young Wolf'])))),
  });
  const store = createAppStore(api, { saveDelayMs: 0 });
  await store.getState().openQuest(60001);
  render(<NamesProvider api={api}><QuestPreview store={store} /></NamesProvider>);
  return { store, api };
}

describe('quest preview drawer', () => {
  it('summarises the quest read-only', async () => {
    const { api } = await mountPreview();
    const drawer = screen.getByRole('complementary', { name: 'Quest preview' });
    expect(drawer).toHaveTextContent('Wolves');
    expect(drawer).toHaveTextContent('#60001');
    expect(drawer).toHaveTextContent('Level 10');
    expect(await screen.findByText('Kill 10 × Diseased Young Wolf')).toBeInTheDocument();
    expect(screen.getByText('15m 5s')).toBeInTheDocument();
    expect(screen.getByText('1 warning')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(api.updateQuest).not.toHaveBeenCalled();
  });
  it('opens the editor', async () => {
    const { store } = await mountPreview();
    await userEvent.click(screen.getByRole('button', { name: 'Edit quest' }));
    expect(store.getState().screen).toBe('edit');
  });
  it('closes', async () => {
    const { store } = await mountPreview();
    await userEvent.click(screen.getByRole('button', { name: 'Close preview' }));
    expect(store.getState().screen).toBe('pick');
    expect(store.getState().open).toBeNull();
  });
});
