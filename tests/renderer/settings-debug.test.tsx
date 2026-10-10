// tests/renderer/settings-debug.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PreferencesSection } from '../../src/renderer/views/settings/PreferencesSection';
import { createAppStore } from '../../src/renderer/state/app-store';
import { makeMockApi, okv } from './mock-api';

afterEach(() => { cleanup(); delete (window as any).api; });

const status = (over: Record<string, unknown> = {}) => ({ enabled: false, events: 0, capacity: 5000, logFile: null, logFailures: 0, logTruncated: false, window: null, ...over });

function mount(initial = status(), over: Record<string, any> = {}) {
  const calls: boolean[] = [];
  const api = makeMockApi({
    debugStatus: async () => okv(initial),
    debugSetEnabled: async (on: boolean) => { calls.push(on); return okv(status({ enabled: on, logFile: on ? 'C:/logs/debug-1.jsonl' : null })); },
    ...over,
  });
  Object.defineProperty(window, 'api', { value: api, configurable: true });
  render(<PreferencesSection store={createAppStore(api, { saveDelayMs: 0 })} onClose={() => {}} setBusy={() => {}} />);
  return calls;
}

describe('the Debug mode switch in Preferences', () => {
  it('is off by default and shows no log path', async () => {
    mount();
    expect(await screen.findByRole('checkbox', { name: 'Debug mode' })).not.toBeChecked();
    expect(screen.queryByText(/debug-1\.jsonl/)).toBeNull();
  });

  it('reflects a saved on state and names the log file', async () => {
    mount(status({ enabled: true, logFile: 'C:/logs/debug-1.jsonl' }));
    expect(await screen.findByRole('checkbox', { name: 'Debug mode' })).toBeChecked();
    expect(screen.getByText(/C:\/logs\/debug-1\.jsonl/)).toBeInTheDocument();
  });

  it('turning it on calls the API once and then shows the log path', async () => {
    const calls = mount();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Debug mode' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Debug mode' })).toBeChecked());
    expect(calls).toEqual([true]);
    expect(await screen.findByText(/debug-1\.jsonl/)).toBeInTheDocument();
  });

  it('says what it records and what it does not', async () => {
    mount();
    expect(await screen.findByText(/key codes and focus changes/i)).toBeInTheDocument();
    expect(screen.getByText(/never the characters you type/i)).toBeInTheDocument();
  });

  it('shows the error when the main process refuses', async () => {
    mount(status(), { debugSetEnabled: async () => ({ ok: false, error: { code: 'UNKNOWN', message: 'Debug mode is not available in this build.' } }) });
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Debug mode' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Debug mode is not available in this build.');
    expect(screen.getByRole('checkbox', { name: 'Debug mode' })).not.toBeChecked();
  });

  it('keeps the existing layout choices', async () => {
    mount();
    expect(await screen.findByRole('radio', { name: 'Under the world' })).toBeInTheDocument();
  });
});
