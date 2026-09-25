// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '../../src/renderer/state/app-store';
import { SettingsDialog } from '../../src/renderer/views/SettingsDialog';
import { TopBar } from '../../src/renderer/components/TopBar';
import type { ConnectSummary, ProfileRecord } from '@shared/ipc';
import type { SchemaDiff } from '@core/schema/diff';
import { makeMockApi, okv, errv, sampleOpen } from './mock-api';

const drift = { missingTables: [], forbiddenTables: [], unregistered: [], missingColumns: [], typeMismatches: [] } as unknown as SchemaDiff;
const summary = (profileId: number): ConnectSummary => ({ profileId, schemaHash: 'h', drift, blocking: false, serverData: null, clientDir: null, client: null });
const world: ProfileRecord = { id: 1, name: 'World', role: 'world' as const, host: 'db.local', port: 3306, user: 'acore', database: 'acore_world', dbcDir: '', clientDir: '', lastConnectedAt: '2026-09-24T10:00:00.000Z' };
const dev: ProfileRecord = { ...world, id: 2, name: 'Dev', role: 'dev' as const, database: 'acore_dev', lastConnectedAt: null };

async function setup(profiles: ProfileRecord[] = [world]) {
  const api = makeMockApi({
    listProfiles: async () => okv(profiles),
    saveProfile: async (p) => okv(p.role === 'world' ? world : dev),
    connect: vi.fn(async (id: number) => okv(summary(id))),
    openQuest: async () => okv(sampleOpen()),
  });
  const store = createAppStore(api);
  await store.getState().loadProfiles();
  await store.getState().connectProfile(1);
  await store.getState().openQuest(60001);
  vi.mocked(api.connect).mockClear();
  const onClose = vi.fn();
  render(<SettingsDialog store={store} onClose={onClose} />);
  return { api, store, onClose };
}

describe('SettingsDialog', () => {
  it('shows the saved connection in a dialog', async () => {
    await setup([world, dev]);
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByLabelText('Host')).toHaveValue('db.local');
    expect(screen.getByLabelText('Dev database')).toHaveValue('acore_dev');
  });
  it('a world change saves and reconnects, then closes', async () => {
    const { api, store, onClose } = await setup();
    await userEvent.type(screen.getByLabelText('Game client folder (optional)'), 'E:/WoW');
    await userEvent.click(screen.getByRole('button', { name: 'Save and reconnect' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.saveProfile).toHaveBeenCalledWith(expect.objectContaining({ id: 1, clientDir: 'E:/WoW' }));
    expect(api.connect).toHaveBeenCalledWith(1);
    expect(store.getState().screen).toBe('pick');
  });
  it('a dev-only change saves without reconnecting', async () => {
    const { api, store, onClose } = await setup();
    await userEvent.click(screen.getByRole('button', { name: 'Add a dev database' }));
    await userEvent.type(screen.getByLabelText('Dev host'), 'devhost');
    await userEvent.type(screen.getByLabelText('Dev user'), 'u');
    await userEvent.type(screen.getByLabelText('Dev database'), 'acore_dev');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.connect).not.toHaveBeenCalled();
    expect(store.getState().open).not.toBeNull();
  });
  it('a failed reconnect keeps the modal open with the error and the old connection', async () => {
    const { api, store, onClose } = await setup();
    vi.mocked(api.connect).mockResolvedValueOnce(errv('CONNECTION', 'Access denied for user acore'));
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Save and reconnect' }));
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    await waitFor(() => expect(dialog).toHaveTextContent('Access denied for user acore'));
    expect(onClose).not.toHaveBeenCalled();
    expect(store.getState().summary?.profileId).toBe(1);
    expect(store.getState().open).not.toBeNull();
  });
  it('can retry a failed reconnect, updating the dev row it added instead of adding another', async () => {
    const { api, onClose } = await setup();
    vi.mocked(api.connect).mockResolvedValueOnce(errv('CONNECTION', 'Cannot reach db.local'));
    await userEvent.type(screen.getByLabelText('Game client folder (optional)'), 'E:/WoW');
    await userEvent.click(screen.getByRole('button', { name: 'Add a dev database' }));
    await userEvent.type(screen.getByLabelText('Dev host'), 'devhost');
    await userEvent.type(screen.getByLabelText('Dev user'), 'u');
    await userEvent.type(screen.getByLabelText('Dev database'), 'acore_dev');
    await userEvent.click(screen.getByRole('button', { name: 'Save and reconnect' }));
    await screen.findByText('Cannot reach db.local');
    await userEvent.click(screen.getByRole('button', { name: 'Save and reconnect' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const devSaves = vi.mocked(api.saveProfile).mock.calls.map((c) => c[0]).filter((p) => p.role === 'dev');
    expect(devSaves).toHaveLength(2);
    expect(devSaves[1]).toMatchObject({ id: 2 });
  });
  it('cannot be dismissed while it is reconnecting', async () => {
    const { api, onClose } = await setup();
    let finish: (v: unknown) => void = () => {};
    vi.mocked(api.connect).mockImplementationOnce(() => new Promise((r) => { finish = r; }) as never);
    await userEvent.type(screen.getByLabelText('Password'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Save and reconnect' }));
    await screen.findByRole('button', { name: 'Saving…' });
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).not.toHaveBeenCalled();
    finish(okv(summary(1)));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
  it('validates before saving', async () => {
    const { api } = await setup();
    await userEvent.clear(screen.getByLabelText('Host'));
    await userEvent.click(screen.getByRole('button', { name: 'Save and reconnect' }));
    expect(screen.getByText('Host is required')).toBeInTheDocument();
    expect(api.saveProfile).not.toHaveBeenCalled();
  });
  it('closes on Escape, Cancel and the close button without saving', async () => {
    const { api, onClose } = await setup();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(api.saveProfile).not.toHaveBeenCalled();
  });
});

describe('TopBar settings button', () => {
  it('opens settings', async () => {
    const onOpenSettings = vi.fn();
    const store = createAppStore(makeMockApi());
    render(<TopBar store={store} onNewQuest={() => {}} onAddExisting={() => {}} onFitView={() => {}} onOpenProject={() => {}} onOpenSettings={onOpenSettings} />);
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onOpenSettings).toHaveBeenCalled();
  });
});
