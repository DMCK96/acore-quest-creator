// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TrackerImportDialog } from '../../src/renderer/views/TrackerImportDialog';
import { createAppStore } from '../../src/renderer/state/app-store';
import { NamesProvider } from '../../src/renderer/state/names';
import { makeMockApi, okv, errv } from './mock-api';

const row = (key: number, title: string) => ({ key, title, status: 'Ready', tier: 2, tier_label: '2 Giver+ender placeable', top_blocker: '', giver: 'npc 18200', ender: 'npc 18200', work: 'none' });
const planned = (questId: number, action = 'create') => ({
  questId, title: `Quest ${questId}`, action, values: { 'quest_template.LogDescription': 'Kill 12 Windrocs.' }, readOnly: [],
  creates: { npcs: [{ entry: 2, name: 'Brun', spawns: [] }], objects: [], items: [] }, references: [{ kind: 'npc', entry: 18200, name: 'Fitz', where: 'world' }],
  unresolved: [{ kind: 'item', entry: 65359, reason: 'The tracker has no data for it.' }], notImported: ['creature_template.unit_flags'],
  givers: [{ kind: 'npc', entry: 18200, how: 'return wording' }], enders: [{ kind: 'npc', entry: 18200, how: 'inferred' }],
  evaluation: { status: 'Ready', tier: 2, blockers: [] }, spawnsNeeded: { npc: 0, object: 0 },
});

function mount(apiOver: Record<string, unknown>) {
  const api = makeMockApi({
    trackerCandidates: vi.fn(async () => okv({ total: 2, rows: [row(1209, 'Windroc Remastery I'), row(1210, 'Windroc Remastery II')], inProject: [1210] })),
    trackerPreview: vi.fn(async (ids: number[]) => okv({ quests: ids.map((id) => planned(id, id === 1210 ? 'replace' : 'create')) })),
    trackerImport: vi.fn(async () => okv({ imported: [1209], replaced: [], skipped: [], warnings: [] })),
    ...apiOver,
  });
  const store = createAppStore(api);
  const onClose = vi.fn();
  render(<NamesProvider api={api}><TrackerImportDialog store={store} onClose={onClose} /></NamesProvider>);
  return { api, store, onClose };
}

describe('import from tracker dialog', () => {
  it('lists candidates, marks ones in the project, and previews one', async () => {
    const { api } = mount({});
    const dialog = await screen.findByRole('dialog', { name: 'Import from CoA Content Tracker' });
    expect(api.trackerCandidates).toHaveBeenCalledWith({ status: 'Ready', page: 1 });
    expect(within(screen.getByRole('row', { name: /1210/ })).getByText('In project')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: /Windroc Remastery I$/ }));
    const preview = await screen.findByRole('region', { name: 'Preview' });
    expect(within(preview).getByText('Kill 12 Windrocs.')).toBeTruthy();
    expect(within(preview).getByText(/Fitz \(npc 18200\) · return wording/)).toBeTruthy();
    expect(within(preview).getByText(/Brun \(npc 2\)/)).toBeTruthy();
    expect(within(preview).getByText(/item 65359: The tracker has no data for it\./)).toBeTruthy();
    expect(within(preview).getByText('creature_template.unit_flags')).toBeTruthy();
  });
  it('imports the previewed quest and opens it', async () => {
    const { api } = mount({});
    await userEvent.click(await screen.findByRole('button', { name: /Windroc Remastery I$/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Import' }));
    expect(api.trackerImport).toHaveBeenCalledWith({ questIds: [1209], replace: [] });
  });
  it('asks before replacing, once for a bulk import', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { api } = mount({ trackerImport: vi.fn(async () => okv({ imported: [1209], replaced: [1210], skipped: [], warnings: [] })) });
    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select quest 1209' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select quest 1210' }));
    await userEvent.click(screen.getByRole('button', { name: 'Import 2 selected' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith('1 of these quests is already in this project. Replace it with the tracker\'s data? Your edits to it will be lost.');
    expect(api.trackerImport).toHaveBeenCalledWith({ questIds: [1209, 1210], replace: [1210] });
    expect(await screen.findByText('Imported 1209. Replaced 1210.')).toBeTruthy();
  });
  it('imports at most 50 at a time', async () => {
    const rows = Array.from({ length: 51 }, (_, i) => row(2000 + i, `Quest ${2000 + i}`));
    mount({ trackerCandidates: vi.fn(async () => okv({ total: 51, rows, inProject: [] })) });
    await screen.findByRole('dialog');
    for (const r of rows) fireEvent.click(screen.getByRole('checkbox', { name: `Select quest ${r.key}` }));
    expect((screen.getByRole('button', { name: 'Import 51 selected' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Import at most 50 quests at a time.')).toBeTruthy();
    // 51 ticks re-render a 51-row table 51 times, which is slow when the whole suite runs at once.
  }, 20000);
  it('shows the tracker error with Retry, and keeps the list when a preview fails', async () => {
    const list = vi.fn().mockResolvedValueOnce(errv('VALIDATION', "The CoA Content Tracker isn't running at http://127.0.0.1:8089. Start it with python tracker.py."))
      .mockResolvedValueOnce(okv({ total: 1, rows: [row(1209, 'Windroc Remastery I')], inProject: [] }));
    mount({ trackerCandidates: list, trackerPreview: vi.fn(async () => errv('VALIDATION', 'The tracker answered 500: boom')) });
    expect(await screen.findByText(/isn't running/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await userEvent.click(await screen.findByRole('button', { name: /Windroc Remastery I$/ }));
    expect(await screen.findByText('The tracker answered 500: boom')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Windroc Remastery I$/ })).toBeTruthy();
  });
});
