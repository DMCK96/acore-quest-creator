// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '../../src/renderer/state/app-store';
import { renderFlow } from './module-harness';
import { makeMockApi, okv, errv, sampleOpen } from './mock-api';

const drift = { missingTables: [], unregistered: [], missingColumns: [], typeMismatches: [] };
const rec = (role: 'world' | 'dev', id: number) => ({ id, name: role, role, host: 'h', port: 1, user: 'u', database: 'd' });
const form = { name: 'w', role: 'world' as const, host: 'h', port: 1, user: 'u', database: 'd', password: 'p' };

async function workspace(over: Record<string, any> = {}, openOver = {}) {
  const api = makeMockApi({
    saveProfile: async () => okv(rec('world', 1)), connect: async () => okv({ profileId: 1, schemaHash: 'h', drift, blocking: false }),
    listProfiles: async () => okv([rec('world', 1)]), openQuest: async () => okv(sampleOpen(openOver)), validate: async () => okv([]),
    previewChanges: async () => okv([]), exportQuest: async () => okv({ path: 'C:\\out\\a.sql', sql: 'DELETE FROM `quest_template` WHERE `ID` = 60001;\n', warnings: [], issues: [] }),
    applyToDev: async () => okv({ statements: 7 }), ...over,
  });
  const store = createAppStore(api, { saveDelayMs: 0 });
  await store.getState().loadProfiles();
  await store.getState().connect(form);
  await store.getState().openQuest(60001);
  const view = renderFlow(store, api);
  return { api, store, unmount: view.unmount };
}

const openAdvanced = async (): Promise<void> => {
  await userEvent.click(screen.getByRole('button', { name: 'Add module' }));
  await userEvent.click(screen.getByRole('menuitem', { name: /Advanced/ }));
};

describe('Unmodelled columns in Advanced', () => {
  it('lists preserved columns read-only, or says everything is covered', async () => {
    await workspace({}, { unmodelled: [{ table: 'quest_template', column: 'FutureCol', values: [{ key: 'ID=60001', value: '9' }] }] });
    await openAdvanced();
    expect(screen.getByText('quest_template.FutureCol')).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getByText(/kept unchanged/i)).toBeInTheDocument();
  });
  it('shows an all-clear message when nothing is unmodelled', async () => {
    await workspace();
    await openAdvanced();
    expect(screen.getByText(/every column in your database is covered/i)).toBeInTheDocument();
  });
});

describe('Changes panel', () => {
  it('shows nothing-changed, then before/after cells grouped by table', async () => {
    const { api } = await workspace();
    await userEvent.click(screen.getByRole('button', { name: 'Changes' }));
    expect(await screen.findByText(/no changes/i)).toBeInTheDocument();
    (api.previewChanges as any).mockResolvedValue(okv([
      { table: 'quest_template', key: 'ID=60001', column: 'LogTitle', before: 'Old', after: 'New' },
      { table: 'quest_template', key: 'ID=60001', column: 'AreaDescription', before: null, after: '' },
      { table: 'creature_queststarter', key: 'id=5,quest=60001', column: null, before: undefined, after: undefined },
    ]));
    await userEvent.click(screen.getByRole('button', { name: 'Close panel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Changes' }));
    expect(await screen.findByText('Old')).toBeInTheDocument();
    expect(screen.getByText('New')).toBeInTheDocument();
    expect(screen.getByText('NULL')).toBeInTheDocument();
    expect(screen.getByText('(empty)')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'creature_queststarter' })).toBeInTheDocument();
  });
});

describe('Export', () => {
  it('saves the draft, exports, and shows the written path and any warnings', async () => {
    const { api } = await workspace({ exportQuest: async () => okv({ path: 'C:\\out\\a.sql', sql: 'x', warnings: [{ code: 'SHARED_ROW_MODIFIED', table: 'creature_loot_template', message: 'Also used by quest 60002' }], issues: [] }) });
    await userEvent.click(screen.getByRole('button', { name: 'Export patch' }));
    expect(await screen.findByText('C:\\out\\a.sql')).toBeInTheDocument();
    expect(screen.getByText('Also used by quest 60002')).toBeInTheDocument();
    expect(api.exportQuest).toHaveBeenCalledWith(60001);
  });
  it('explains validation, fidelity and id-collision refusals', async () => {
    const issue = { severity: 'error', code: 'NO_TITLE', message: 'The quest needs a title.' };
    const cases: [any, string | RegExp][] = [
      [{ code: 'VALIDATION', message: 'Fix these first', issues: [issue] }, 'The quest needs a title.'],
      [{ code: 'FIDELITY', message: 'This quest does not round-trip', differences: [] }, /does not round-trip/],
      [{ code: 'ID_COLLISION', message: 'Quest 60001 already exists in the world database' }, /already exists/],
    ];
    for (const [error, text] of cases) {
      const { unmount } = await workspace({ exportQuest: async () => ({ ok: false, error }) });
      await userEvent.click(screen.getByRole('button', { name: 'Export patch' }));
      expect(await screen.findByText(text)).toBeInTheDocument();
      unmount();
    }
  });
  it('disables export while the quest is unsafe', async () => {
    await workspace({}, { fidelity: { ok: false, differences: [{ table: 't', key: 'ID=1', column: 'c', before: 'a', after: 'b' }] } });
    expect(screen.getByRole('button', { name: 'Export patch' })).toBeDisabled();
  });
});

describe('Apply to dev DB', () => {
  it('is disabled with an explanation when no dev profile is configured', async () => {
    await workspace();
    expect(screen.getByRole('button', { name: 'Apply to dev DB' })).toBeDisabled();
    expect(screen.getByText(/add a dev database profile/i)).toBeInTheDocument();
  });
  const withDev = () => workspace({ listProfiles: async () => okv([rec('world', 1), rec('dev', 2)]) });
  it('shows the SQL and applies only after confirmation', async () => {
    const { api } = await withDev();
    await userEvent.click(screen.getByRole('button', { name: 'Apply to dev DB' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/DELETE FROM `quest_template`/)).toBeInTheDocument();
    expect(api.applyToDev).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(api.applyToDev).toHaveBeenCalledWith(60001, true));
    expect(await screen.findByText(/applied 7 statements/i)).toBeInTheDocument();
  });
  it('does nothing when cancelled', async () => {
    const { api } = await withDev();
    await userEvent.click(screen.getByRole('button', { name: 'Apply to dev DB' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(api.applyToDev).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('reports a failed apply without claiming success', async () => {
    await workspace({ listProfiles: async () => okv([rec('world', 1), rec('dev', 2)]), applyToDev: async () => errv('UNKNOWN', 'Statement 3 failed: Duplicate entry') });
    await userEvent.click(screen.getByRole('button', { name: 'Apply to dev DB' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText(/Statement 3 failed/)).toBeInTheDocument();
    expect(screen.queryByText(/applied \d+ statements/i)).toBeNull();
  });
});
