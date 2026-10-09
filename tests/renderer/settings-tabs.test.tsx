// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '../../src/renderer/state/app-store';
import { SettingsDialog } from '../../src/renderer/views/SettingsDialog';
import { SETTINGS_SECTIONS } from '../../src/renderer/views/settings/sections';
import { readPreferences } from '../../src/renderer/preferences/store';
import { makeMockApi } from './mock-api';

afterEach(() => localStorage.clear());
const open = () => render(<SettingsDialog store={createAppStore(makeMockApi(), { saveDelayMs: 0 })} onClose={() => {}} />);

describe('Settings tabs', () => {
  it('registers Connection, Preferences then MCP / AI', () => {
    expect(SETTINGS_SECTIONS.map((s) => s.title)).toEqual(['Connection', 'Preferences', 'MCP / AI']);
  });

  it('opens on Connection, with the connection card and its Save', () => {
    open();
    expect(screen.getByRole('tab', { name: 'Connection', selected: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Save/ })).toBeTruthy();
  });

  it('shows the layout preference on its tab and applies a change at once, with no Save', async () => {
    open();
    await userEvent.click(screen.getByRole('tab', { name: 'Preferences' }));
    expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: /Beside the world/i }));
    expect(readPreferences().dockSide).toBe('right');
    await userEvent.click(screen.getByRole('radio', { name: /Under the world/i }));
    expect(readPreferences().dockSide).toBe('bottom');
  });

  it('has one Close button whichever tab is showing', async () => {
    const onClose = vi.fn();
    render(<SettingsDialog store={createAppStore(makeMockApi(), { saveDelayMs: 0 })} onClose={onClose} />);
    expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(1);
    await userEvent.click(screen.getByRole('tab', { name: 'Preferences' }));
    expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves between tabs with the arrow keys', async () => {
    open();
    screen.getByRole('tab', { name: 'Connection' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Preferences', selected: true })).toBeTruthy();
  });

  it('keeps unsaved connection edits when switching tabs and back', async () => {
    open();
    await userEvent.type(screen.getByLabelText('Host'), 'x');
    const typed = (screen.getByLabelText('Host') as HTMLInputElement).value;
    await userEvent.click(screen.getByRole('tab', { name: 'Preferences' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Connection' }));
    expect((screen.getByLabelText('Host') as HTMLInputElement).value).toBe(typed);
  });
});
