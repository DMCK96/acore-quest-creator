// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '../../src/renderer/state/app-store';
import { LoginScreen } from '../../src/renderer/views/LoginScreen';
import type { ConnectSummary } from '@shared/ipc';
import type { SchemaDiff } from '@core/schema/diff';
import { makeMockApi, okv, errv } from './mock-api';

const drift = { missingTables: [], forbiddenTables: [], unregistered: [], missingColumns: [], typeMismatches: [] } as unknown as SchemaDiff;
const summary: ConnectSummary = { profileId: 1, schemaHash: 'h', drift, blocking: false, serverData: null, clientDir: null, client: null };
const world = { id: 1, name: 'World', role: 'world' as const, host: 'db.local', port: 3306, user: 'acore', database: 'acore_world', dbcDir: '', clientDir: '', lastConnectedAt: '2026-09-24T10:00:00.000Z' };

describe('LoginScreen', () => {
  it('on a first launch saves the details then connects, reaching the picker', async () => {
    const api = makeMockApi({ saveProfile: async () => okv(world), listProfiles: async () => okv([world]), connect: async () => okv(summary) });
    const store = createAppStore(api);
    render(<LoginScreen store={store} />);
    await userEvent.type(screen.getByLabelText('Host'), '127.0.0.1');
    await userEvent.type(screen.getByLabelText('User'), 'ro');
    await userEvent.type(screen.getByLabelText('Database'), 'acore_world');
    await userEvent.type(screen.getByLabelText('Password'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Save and connect' }));
    await waitFor(() => expect(store.getState().screen).toBe('pick'));
    expect(api.saveProfile).toHaveBeenCalledWith({ name: 'World', role: 'world', host: '127.0.0.1', port: 3306, user: 'ro', database: 'acore_world', password: 'pw', dbcDir: '', clientDir: '' });
    expect(api.connect).toHaveBeenCalledWith(1);
  });
  it('for a returning user is filled in and leads with Connect, keeping the saved password', async () => {
    const api = makeMockApi({ saveProfile: async () => okv(world), listProfiles: async () => okv([world]), connect: async () => okv(summary) });
    const store = createAppStore(api);
    await store.getState().loadProfiles();
    render(<LoginScreen store={store} />);
    expect(screen.getByLabelText('Host')).toHaveValue('db.local');
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(store.getState().screen).toBe('pick'));
    expect(vi.mocked(api.saveProfile).mock.calls[0]![0]).not.toHaveProperty('password');
  });
  it('fills in once profiles load, unless the user has typed', async () => {
    const api = makeMockApi({ listProfiles: async () => okv([world]) });
    const store = createAppStore(api);
    const { unmount } = render(<LoginScreen store={store} />);
    expect(screen.getByRole('button', { name: 'Save and connect' })).toBeInTheDocument();
    await act(() => store.getState().loadProfiles());
    expect(screen.getByLabelText('Host')).toHaveValue('db.local');
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
    unmount();

    const store2 = createAppStore(api);
    render(<LoginScreen store={store2} />);
    await userEvent.type(screen.getByLabelText('Host'), 'typed');
    await act(() => store2.getState().loadProfiles());
    expect(screen.getByLabelText('Host')).toHaveValue('typed');
  });
  it('shows validation beside the fields and sends nothing', async () => {
    const api = makeMockApi();
    const store = createAppStore(api);
    render(<LoginScreen store={store} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save and connect' }));
    expect(screen.getByText('Host is required')).toBeInTheDocument();
    expect(api.saveProfile).not.toHaveBeenCalled();
  });
  it('submits on Enter', async () => {
    const api = makeMockApi({ saveProfile: async () => okv(world), listProfiles: async () => okv([world]), connect: async () => okv(summary) });
    const store = createAppStore(api);
    await store.getState().loadProfiles();
    render(<LoginScreen store={store} />);
    await userEvent.type(screen.getByLabelText('Database'), '{Enter}');
    await waitFor(() => expect(api.connect).toHaveBeenCalledWith(1));
  });
  it('shows a readable error when the server is unreachable, and stays', async () => {
    const api = makeMockApi({ saveProfile: async () => okv(world), listProfiles: async () => okv([world]), connect: async () => errv('CONNECTION', 'Cannot reach db.local:3306 (ECONNREFUSED)') });
    const store = createAppStore(api);
    await store.getState().loadProfiles();
    render(<LoginScreen store={store} />);
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach db.local:3306');
    expect(store.getState().screen).toBe('connect');
    expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled();
  });
  it('a retry after a failed connect updates the rows it saved rather than adding new ones', async () => {
    const saved = { ...world, lastConnectedAt: null };
    const api = makeMockApi({ saveProfile: async () => okv(saved), listProfiles: async () => okv([saved]), connect: vi.fn(async () => errv('CONNECTION', 'Access denied')) });
    const store = createAppStore(api);
    render(<LoginScreen store={store} />);
    await userEvent.type(screen.getByLabelText('Host'), 'db.local');
    await userEvent.type(screen.getByLabelText('User'), 'acore');
    await userEvent.type(screen.getByLabelText('Database'), 'acore_world');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Save and connect' }));
    await screen.findByRole('alert');
    vi.mocked(api.connect).mockResolvedValueOnce(okv(summary));
    await userEvent.type(screen.getByLabelText('Password'), 'right');
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(store.getState().screen).toBe('pick'));
    expect(vi.mocked(api.saveProfile).mock.calls[1]![0]).toMatchObject({ id: 1, password: 'right' });
  });
  it('shows a save failure in the alert', async () => {
    const api = makeMockApi({ saveProfile: async () => errv('VALIDATION', 'Secret storage is unavailable') });
    const store = createAppStore(api);
    render(<LoginScreen store={store} />);
    await userEvent.type(screen.getByLabelText('Host'), 'h');
    await userEvent.type(screen.getByLabelText('User'), 'u');
    await userEvent.type(screen.getByLabelText('Database'), 'd');
    await userEvent.click(screen.getByRole('button', { name: 'Save and connect' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Secret storage is unavailable');
    expect(api.connect).not.toHaveBeenCalled();
  });
  it('shows the orb behind the card', () => {
    const { container } = render(<LoginScreen store={createAppStore(makeMockApi())} />);
    expect(container.querySelector('.login__orb .quest-orb')).not.toBeNull();
  });
});
