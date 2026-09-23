// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '../../src/renderer/state/app-store';
import { renderFlow } from './module-harness';
import { makeMockApi, okv, sampleOpen } from './mock-api';
import type { OpenResult } from '@shared/ipc';

const profileRec = { id: 1, name: 'local', role: 'world' as const, host: 'h', port: 3306, user: 'u', database: 'd' };
const drift = { missingTables: [], unregistered: [], missingColumns: [], typeMismatches: [], blockingTables: [] };
const summary = { profileId: 1, schemaHash: 'h', drift, blocking: false };
const form = { name: 'local', role: 'world' as const, host: 'h', port: 3306, user: 'u', database: 'd', password: 'p' };

async function storyOf(over: Partial<OpenResult>) {
  const api = makeMockApi({
    saveProfile: async () => okv(profileRec),
    connect: async () => okv(summary),
    openQuest: async () => okv(sampleOpen(over)),
    validate: async () => okv([]),
  });
  const store = createAppStore(api, { saveDelayMs: 0 });
  await store.getState().connect(form);
  await store.getState().openQuest(60001);
  renderFlow(store, api);
  await userEvent.click(screen.getByRole('button', { name: /^Dialogue/ }));
  return store;
}

const withLocales: Partial<OpenResult> = {
  locales: ['deDE', 'frFR'],
  importedText: { 'quest_template.LogTitle': 'Wolves' },
};

/** Spec §4.3: "If the user edits enUS text, the UI notes that locale rows are not updated." */
describe('locale notice', () => {
  it('says nothing while the English text still matches the imported row', async () => {
    await storyOf(withLocales);
    expect(screen.queryByTestId('locale-notice')).toBeNull();
  });

  it('warns, naming the locales, once an English text field is edited', async () => {
    const store = await storyOf(withLocales);
    store.getState().setValue('quest_template.LogTitle', 'Wolves of Elwynn');
    const notice = await screen.findByTestId('locale-notice');
    expect(notice).toHaveTextContent(/deDE/);
    expect(notice).toHaveTextContent(/frFR/);
    expect(notice).toHaveTextContent(/Quest title/);
    expect(notice.textContent).toMatch(/translat/i);
  });

  it('stays quiet for a quest that has no locale rows at all', async () => {
    const store = await storyOf({ locales: [], importedText: { 'quest_template.LogTitle': 'Wolves' } });
    store.getState().setValue('quest_template.LogTitle', 'Wolves of Elwynn');
    await waitFor(() => expect(screen.getByLabelText('Quest title')).toHaveValue('Wolves of Elwynn'));
    expect(screen.queryByTestId('locale-notice')).toBeNull();
  });

  it('goes away again when the text is put back', async () => {
    const store = await storyOf(withLocales);
    store.getState().setValue('quest_template.LogTitle', 'Changed');
    await screen.findByTestId('locale-notice');
    store.getState().setValue('quest_template.LogTitle', 'Wolves');
    await waitFor(() => expect(screen.queryByTestId('locale-notice')).toBeNull());
  });
});
