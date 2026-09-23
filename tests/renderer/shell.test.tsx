// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '../../src/renderer/state/app-store';
import { ConnectionScreen } from '../../src/renderer/views/ConnectionScreen';
import { QuestPicker } from '../../src/renderer/views/QuestPicker';
import { QuestWorkspace } from '../../src/renderer/views/QuestWorkspace';
import { makeMockApi, okv, errv, sampleOpen } from './mock-api';

const drift = { missingTables: [], unregistered: [], missingColumns: [], typeMismatches: [] };
const summary = { profileId: 1, schemaHash: 'h', drift, blocking: false };
const profileRec = { id: 1, name: 'local', role: 'world' as const, host: 'h', port: 3306, user: 'u', database: 'd' };
const form = { name: 'local', role: 'world' as const, host: '127.0.0.1', port: 3306, user: 'ro', database: 'acore_world', password: 'pw' };

describe('ConnectionScreen', () => {
  it('saves the profile then connects, moving to the picker', async () => {
    const api = makeMockApi({ saveProfile: async () => okv(profileRec), connect: async () => okv(summary) });
    const store = createAppStore(api);
    render(<ConnectionScreen store={store} />);
    await userEvent.type(screen.getByLabelText('Host'), '127.0.0.1');
    await userEvent.type(screen.getByLabelText('User'), 'ro');
    await userEvent.type(screen.getByLabelText('Database'), 'acore_world');
    await userEvent.type(screen.getByLabelText('Password'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Save and connect' }));
    await waitFor(() => expect(store.getState().screen).toBe('pick'));
    expect(api.saveProfile).toHaveBeenCalledWith(expect.objectContaining({ host: '127.0.0.1', database: 'acore_world', role: 'world' }));
    expect(api.connect).toHaveBeenCalledWith(1);
  });
  it('lists saved profiles on launch and connects to one with its stored password', async () => {
    const api = makeMockApi({ listProfiles: async () => okv([profileRec]), connect: async () => okv(summary) });
    const store = createAppStore(api);
    await store.getState().start();
    render(<ConnectionScreen store={store} />);
    await userEvent.click(screen.getByRole('button', { name: 'Connect to local' }));
    await waitFor(() => expect(store.getState().screen).toBe('pick'));
    expect(api.connect).toHaveBeenCalledWith(1);
    expect(api.saveProfile).not.toHaveBeenCalled();
  });
  it('connects on launch to the startup profile, once', async () => {
    const api = makeMockApi({ startupProfile: async () => okv(1), connect: async () => okv(summary) });
    const store = createAppStore(api);
    await Promise.all([store.getState().start(), store.getState().start()]);
    expect(store.getState().screen).toBe('pick');
    expect(api.connect).toHaveBeenCalledTimes(1);
  });
  it('editing a saved profile updates it and keeps the password when left blank', async () => {
    const api = makeMockApi({ listProfiles: async () => okv([profileRec]), saveProfile: async () => okv(profileRec), connect: async () => okv(summary) });
    const store = createAppStore(api);
    await store.getState().loadProfiles();
    render(<ConnectionScreen store={store} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit local' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save and connect' }));
    await waitFor(() => expect(store.getState().screen).toBe('pick'));
    const sent = vi.mocked(api.saveProfile).mock.calls[0]![0];
    expect(sent).toMatchObject({ id: 1, host: 'h' });
    expect(sent).not.toHaveProperty('password');
  });
  it('shows a readable error when the server is unreachable', async () => {
    const api = makeMockApi({ saveProfile: async () => okv(profileRec), connect: async () => errv('CONNECTION', 'Cannot reach h:3306 (ECONNREFUSED)') });
    const store = createAppStore(api);
    await store.getState().connect(form);
    render(<ConnectionScreen store={store} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Cannot reach h:3306');
    expect(store.getState().screen).toBe('connect');
  });
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
});

describe('QuestPicker', () => {
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
    await waitFor(() => expect(store.getState().screen).toBe('edit'));
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

describe('QuestWorkspace', () => {
  const opened = async (over = {}) => {
    const api = makeMockApi({ saveProfile: async () => okv(profileRec), connect: async () => okv(summary), openQuest: async () => okv(sampleOpen(over)), validate: async () => okv([]) });
    const store = createAppStore(api, { saveDelayMs: 0 });
    await store.getState().connect(form);
    await store.getState().openQuest(60001);
    return { api, store };
  };
  it('shows title, id and the group navigation', async () => {
    const { store } = await opened();
    render(<QuestWorkspace store={store} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('60001');
    for (const name of ['Identity', 'Story', 'Objectives', 'Rewards', 'Availability', 'Map', 'Unmodelled columns', 'Changes']) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument();
    }
  });
  it('renders the real group panel content when a group tab is selected, not a placeholder', async () => {
    const { store } = await opened();
    render(<QuestWorkspace store={store} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Story' }));
    expect(screen.getByLabelText('Quest title')).toBeInTheDocument();
    expect(screen.queryByText(/editor is not implemented yet/i)).toBeNull();
  });
  it('hides the fidelity banner when ok and shows an unsafe-to-export banner with the differences when not', async () => {
    const good = await opened();
    const { unmount } = render(<QuestWorkspace store={good.store} />);
    expect(screen.queryByText(/unsafe to export/i)).toBeNull();
    unmount();
    const bad = await opened({ fidelity: { ok: false, differences: [{ table: 'quest_template', key: 'ID=60001', column: 'LogTitle', before: 'a', after: 'b' }] } });
    render(<QuestWorkspace store={bad.store} />);
    expect(screen.getByText(/unsafe to export/i)).toBeInTheDocument();
    expect(screen.getByText(/quest_template.*LogTitle/)).toBeInTheDocument();
  });
  it('says a whole row was added or removed rather than "(absent) → (absent)"', async () => {
    const { store } = await opened({
      fidelity: { ok: false, differences: [
        { table: 'quest_poi_points', key: 'QuestID=60001,Idx1=0,Idx2=1', column: null, before: undefined, after: undefined, kind: 'removed' },
        { table: 'conditions', key: 'SourceEntry=60001', column: null, before: undefined, after: undefined, kind: 'added' },
      ] },
    });
    render(<QuestWorkspace store={store} />);
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
  it('saves the pending edit before "Back to quests" clears the editor', async () => {
    const api = makeMockApi({ saveProfile: async () => okv(profileRec), connect: async () => okv(summary), openQuest: async () => okv(sampleOpen()), validate: async () => okv([]) });
    const store = createAppStore(api, { saveDelayMs: 10_000 });
    await store.getState().connect(form);
    await store.getState().openQuest(60001);
    render(<QuestWorkspace store={store} />);
    store.getState().setValue('quest_template.LogTitle', 'Edited');
    expect(store.getState().dirty).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: /Back to quests/ }));
    await waitFor(() => expect(store.getState().screen).toBe('pick'));
    expect(api.updateQuest).toHaveBeenCalledWith(
      expect.objectContaining({ values: expect.objectContaining({ 'quest_template.LogTitle': 'Edited' }) }),
    );
    expect(store.getState().open).toBeNull();
  });
  it('lists validation issues with their severity', async () => {
    const { store } = await opened({ issues: [{ severity: 'error', code: 'NO_TITLE', message: 'The quest needs a title.' }, { severity: 'warning', code: 'NO_ENDER', message: 'Nobody can turn this quest in.' }] });
    render(<QuestWorkspace store={store} />);
    expect(screen.getByText('The quest needs a title.')).toBeInTheDocument();
    expect(screen.getByText('Nobody can turn this quest in.')).toBeInTheDocument();
  });
});
