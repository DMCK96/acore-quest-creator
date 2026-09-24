// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TestInGameView } from '../../src/renderer/views/TestInGameView';
import { makeMockApi, okv } from './mock-api';

const commands = {
  reload: [{ command: '.reload smart_scripts', label: 'Scripts' }],
  restart: [{ reason: 'New spawns appear after a server restart: the server loads spawns when it starts.' }],
  go: [{ command: '.go xyz 1 2 3 0', label: 'Scout Hela' }],
  quest: [{ command: '.quest add 60001', label: 'Take the quest' }],
};

describe('Test in game', () => {
  it('lists the commands in groups and copies one', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<TestInGameView api={makeMockApi({ testCommands: async () => okv(commands) })} questId={60001} />);
    expect(await screen.findByRole('heading', { name: 'Reload after applying' })).toBeInTheDocument();
    expect(screen.getByText(/New spawns appear after a server restart/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Copy .go xyz 1 2 3 0' }));
    expect(writeText).toHaveBeenCalledWith('.go xyz 1 2 3 0');
  });
  it('does not fail when the clipboard is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    render(<TestInGameView api={makeMockApi({ testCommands: async () => okv(commands) })} questId={60001} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Copy .quest add 60001' }));
    expect(screen.getByText('.quest add 60001')).toBeInTheDocument();
  });
});
