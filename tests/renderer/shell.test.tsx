// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '../../src/renderer/state/app-store';
import { QuestPicker } from '../../src/renderer/views/QuestPicker';
import { TopBar } from '../../src/renderer/components/TopBar';
import { renderFlow } from './module-harness';
import { makeMockApi, okv, errv, sampleOpen } from './mock-api';

const drift = { missingTables: [], unregistered: [], missingColumns: [], typeMismatches: [] };
const summary = { profileId: 1, schemaHash: 'h', drift, blocking: false };
const profileRec = { id: 1, name: 'local', role: 'world' as const, host: 'h', port: 3306, user: 'u', database: 'd' };
const form = { name: 'local', role: 'world' as const, host: '127.0.0.1', port: 3306, user: 'ro', database: 'acore_world', password: 'pw' };

describe('QuestPicker', () => {
  it('tells the user about unmodelled columns and blocks on blocking drift', async () => {
    const drifted = { ...summary, drift: { ...drift, unregistered: [{ table: 'quest_template', column: 'X' }] } };
    const api = makeMockApi({ saveProfile: async () => okv(profileRec), connect: async () => okv(drifted) });
    const store = createAppStore(api);
    await store.getState().connect(form);
    render(<QuestPicker store={store} />);
    expect(screen.getByText(/1 column.*not modelled/i)).toBeInTheDocument();

    const blocked = { ...summary, blocking: true, drift: { ...drift, missingTables: ['quest_offer_reward'] } };
    const api2 = makeMockApi({ saveProfile: async () => okv(profileRec), connect: async () => okv(blocked) });
    const store2 = createAppStore(api2);
    await store2.getState().connect(form);
    expect(store2.getState().screen).toBe('connect');
    expect(store2.getState().error).toMatch(/quest_offer_reward/);
  });
  it('searches, opens a result and starts a new quest', async () => {
    const api = makeMockApi({
      saveProfile: async () => okv(profileRec), connect: async () => okv(summary),
      searchQuests: async () => okv([{ id: 5, title: 'Wolves of Elwynn', level: 3 }]),
      openQuest: async () => okv(sampleOpen()), newQuest: async () => okv(sampleOpen({ questId: 60000 })),
    });
    const store = createAppStore(api);
    await store.getState().connect(form);
    render(<QuestPicker store={store} />);
    await userEvent.type(screen.getByRole('searchbox'), 'wolves');
    await userEvent.click(await screen.findByRole('button', { name: /Wolves of Elwynn/ }));
    await waitFor(() => expect(store.getState().screen).toBe('preview'));
    expect(api.openQuest).toHaveBeenCalledWith(5);
    store.getState().backToPicker();
    await userEvent.click(screen.getByRole('button', { name: 'New quest' }));
    await waitFor(() => expect(api.newQuest).toHaveBeenCalled());
  });
  it('shows the API error when a quest cannot be opened', async () => {
    const api = makeMockApi({ saveProfile: async () => okv(profileRec), connect: async () => okv(summary), openQuest: async () => errv('QUEST_NOT_FOUND', 'Quest 9 does not exist') });
    const store = createAppStore(api);
    await store.getState().connect(form);
    await store.getState().openQuest(9);
    expect(store.getState().screen).toBe('pick');
    expect(store.getState().error).toBe('Quest 9 does not exist');
  });
});

describe('Quest flow view', () => {
  const opened = async (over = {}) => {
    const api = makeMockApi({ saveProfile: async () => okv(profileRec), connect: async () => okv(summary), openQuest: async () => okv(sampleOpen(over)), validate: async () => okv([]) });
    const store = createAppStore(api, { saveDelayMs: 0 });
    await store.getState().connect(form);
    await store.getState().openQuest(60001);
    return { api, store };
  };
  it('shows title, id and the modules', async () => {
    const { api, store } = await opened();
    renderFlow(store, api);
    expect(screen.getByLabelText('Quest title')).toHaveValue('Wolves');
    expect(screen.getByText('#60001')).toBeInTheDocument();
    for (const name of ['Quest Giver', 'Objectives', 'Dialogue', 'Rewards']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${name}`) })).toBeInTheDocument();
    }
  });
  it('renders the real module content when a module is opened, not a placeholder', async () => {
    const { api, store } = await opened({
      aggregate: { questId: 60001, isNew: false, readOnly: [], sharedItems: {}, values: { 'quest_template.LogTitle': 'Wolves', 'quest_template.QuestDescription': '' } },
    });
    renderFlow(store, api);
    await userEvent.click(screen.getByRole('button', { name: /^Dialogue/ }));
    expect(screen.getByLabelText('Offer text')).toBeInTheDocument();
    expect(screen.queryByText(/editor is not implemented yet/i)).toBeNull();
  });
  it('hides the fidelity banner when ok and shows an unsafe-to-export banner with the differences when not', async () => {
    const good = await opened();
    const { unmount } = renderFlow(good.store, good.api);
    expect(screen.queryByText(/unsafe to export/i)).toBeNull();
    unmount();
    const bad = await opened({ fidelity: { ok: false, differences: [{ table: 'quest_template', key: 'ID=60001', column: 'LogTitle', before: 'a', after: 'b' }] } });
    renderFlow(bad.store, bad.api);
    expect(screen.getByText(/unsafe to export/i)).toBeInTheDocument();
    expect(screen.getByText(/quest_template.*LogTitle/)).toBeInTheDocument();
  });
  it('says a whole row was added or removed rather than "(absent) → (absent)"', async () => {
    const { api, store } = await opened({
      fidelity: { ok: false, differences: [
        { table: 'quest_poi_points', key: 'QuestID=60001,Idx1=0,Idx2=1', column: null, before: undefined, after: undefined, kind: 'removed' },
        { table: 'conditions', key: 'SourceEntry=60001', column: null, before: undefined, after: undefined, kind: 'added' },
      ] },
    });
    renderFlow(store, api);
    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent('row removed');
    expect(banner).toHaveTextContent('row added');
    expect(banner.textContent).not.toContain('(absent) → (absent)');
  });
  it('saves edits as a draft and refreshes validation', async () => {
    const { api, store } = await opened();
    store.getState().setValue('quest_template.LogTitle', 'Edited');
    expect(store.getState().dirty).toBe(true);
    await store.getState().flushSave();
    expect(api.updateQuest).toHaveBeenCalledWith(expect.objectContaining({ values: expect.objectContaining({ 'quest_template.LogTitle': 'Edited' }) }));
    expect(api.validate).toHaveBeenCalledWith(60001);
    expect(store.getState().dirty).toBe(false);
  });
  it('redraws the canvas after an autosave, so a cleared link loses its edge straight away', async () => {
    const { api, store } = await opened();
    vi.mocked(api.listNodes).mockClear();
    store.getState().setValue('quest_template_addon.PrevQuestID', 0);
    await waitFor(() => expect(api.listNodes).toHaveBeenCalled());
    const saved = vi.mocked(api.updateQuest).mock.invocationCallOrder[0];
    expect(vi.mocked(api.listNodes).mock.invocationCallOrder[0]).toBeGreaterThan(saved);
  });
  // A real debounce, so the click lands inside the window the user would actually hit.
  it('saves the pending edit before "Back to chain" leaves the editor', async () => {
    const api = makeMockApi({ saveProfile: async () => okv(profileRec), connect: async () => okv(summary), openQuest: async () => okv(sampleOpen()), validate: async () => okv([]) });
    const store = createAppStore(api, { saveDelayMs: 10_000 });
    await store.getState().connect(form);
    await store.getState().openQuest(60001);
    renderFlow(store, api);
    store.getState().setValue('quest_template.LogTitle', 'Edited');
    expect(store.getState().dirty).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: '← Back to chain' }));
    await waitFor(() => expect(store.getState().screen).toBe('preview'));
    expect(api.updateQuest).toHaveBeenCalledWith(
      expect.objectContaining({ values: expect.objectContaining({ 'quest_template.LogTitle': 'Edited' }) }),
    );
  });
  it('lists validation issues with their severity', async () => {
    const { api, store } = await opened({ issues: [{ severity: 'error', code: 'NO_TITLE', message: 'The quest needs a title.' }, { severity: 'warning', code: 'NO_ENDER', message: 'Nobody can turn this quest in.' }] });
    renderFlow(store, api);
    expect(screen.getByText('The quest needs a title.')).toBeInTheDocument();
    expect(screen.getByText('Nobody can turn this quest in.')).toBeInTheDocument();
  });
});

describe('game client pill', () => {
  const connectWith = async (client: unknown) => {
    const api = makeMockApi({ listProfiles: async () => okv([profileRec]), connect: async () => okv({ ...summary, clientDir: 'E:/WoW', client }) });
    const store = createAppStore(api);
    await store.getState().loadProfiles();
    await store.getState().connectProfile(1);
    render(<TopBar store={store} onNewQuest={() => {}} onAddExisting={() => {}} onFitView={() => {}} onOpenProject={() => {}} onOpenSettings={() => {}} />);
  };
  it('shows the client folder read cleanly', async () => {
    await connectWith({ dir: 'E:/WoW', archives: ['common.MPQ', 'patch.MPQ'], problems: [] });
    expect(screen.getByText('Game client')).toHaveAttribute('title', expect.stringContaining('Read 2 archives'));
  });
  it('warns when the folder is not a game client', async () => {
    await connectWith({ dir: 'E:/Downloads', archives: [], problems: ['No game archives were found in this folder.'] });
    const pill = screen.getByText('Game client: 1 problem');
    expect(pill).toHaveClass('status-pill--warning');
    expect(pill).toHaveAttribute('title', expect.stringContaining('No game archives'));
  });
  it('is not shown without a client folder', async () => {
    await connectWith(null);
    expect(screen.queryByText(/Game client/)).toBeNull();
  });
});
