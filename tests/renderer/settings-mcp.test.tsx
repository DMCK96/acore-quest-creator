// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { McpSection } from '../../src/renderer/views/settings/McpSection';
import { createAppStore } from '../../src/renderer/state/app-store';
import { makeMockApi, okv } from './mock-api';

afterEach(() => { cleanup(); delete (window as any).api; });
const status = (over: Record<string, unknown> = {}) => ({ enabled: false, port: 47600, url: 'http://127.0.0.1:47600/mcp', token: 'secret-token', running: false, error: null, ...over });
function mount(initial = status(), over: Record<string, any> = {}) {
  const calls: any[] = [];
  const api = makeMockApi({
    mcpStatus: async () => okv(initial),
    mcpConfigure: async (c: any) => { calls.push(c); return okv(status({ ...c, running: c.enabled })); },
    mcpRegenerateToken: async () => okv(status({ enabled: true, running: true, token: 'new-token' })),
    ...over,
  });
  Object.defineProperty(window, 'api', { value: api, configurable: true });
  render(<McpSection store={createAppStore(api, { saveDelayMs: 0 })} onClose={() => {}} setBusy={() => {}} />);
  return calls;
}

describe('the Claude settings tab', () => {
  it('is off by default and shows no address or token', async () => {
    mount();
    expect(await screen.findByRole('checkbox', { name: /allow claude/i })).not.toBeChecked();
    expect(screen.queryByText(/127\.0\.0\.1/)).toBeNull();
    expect(screen.queryByText('secret-token')).toBeNull();
  });

  it('turning it on sends the port and then shows the address', async () => {
    const calls = mount();
    await userEvent.click(await screen.findByRole('checkbox', { name: /allow claude/i }));
    await waitFor(() => expect(calls).toEqual([{ enabled: true, port: 47600 }]));
    expect(await screen.findByText('http://127.0.0.1:47600/mcp')).toBeInTheDocument();
  });

  it('keeps the token hidden until Show is pressed, and offers the ready command', async () => {
    mount(status({ enabled: true, running: true }));
    expect(await screen.findByText('http://127.0.0.1:47600/mcp')).toBeInTheDocument();
    expect(screen.queryByText('secret-token')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /show/i }));
    expect(screen.getByText('secret-token')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy command/i })).toBeInTheDocument();
  });

  it('makes a new token on request', async () => {
    mount(status({ enabled: true, running: true }));
    await userEvent.click(await screen.findByRole('button', { name: /new token/i }));
    await userEvent.click(await screen.findByRole('button', { name: /show/i }));
    expect(await screen.findByText('new-token')).toBeInTheDocument();
  });

  it('sends a changed port while it is on', async () => {
    const calls = mount(status({ enabled: true, running: true }));
    const port = await screen.findByRole('spinbutton', { name: /port/i });
    await userEvent.clear(port);
    await userEvent.type(port, '50123');
    await userEvent.tab();
    await waitFor(() => expect(calls).toEqual([{ enabled: true, port: 50123 }]));
  });

  it('says why when the port could not be used', async () => {
    mount(status(), { mcpConfigure: async () => okv(status({ error: 'Port 47600 is already in use.' })) });
    await userEvent.click(await screen.findByRole('checkbox', { name: /allow claude/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already in use');
  });
});
