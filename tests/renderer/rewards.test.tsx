// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mountBody } from './module-harness';
import { makeMockApi, okv } from './mock-api';

const xp = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
const money = [null, 5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000, 45000]; // copper
const api = makeMockApi({ rewardTables: async () => okv({ xp, money }) });

async function mount(over: Record<string, any> = {}, onChange = vi.fn()) {
  return mountBody('rewards', over, { api, onChange });
}

describe('Rewards group', () => {
  it('labels XP difficulties with the XP they give at the quest level', async () => {
    await mount({ 'quest_template.RewardXPDifficulty': 2 });
    expect(await screen.findByRole('option', { name: '2 — 300 XP' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /XP reward/i })).toHaveDisplayValue('2 — 300 XP');
  });
  it('explains that the XP depends on player level when the quest level is not fixed', async () => {
    await mount({ 'quest_template.QuestLevel': -1 });
    expect(await screen.findByText(/depends on the player's level/i)).toBeInTheDocument();
  });
  it('shows what a money difficulty pays and that 0 uses the fixed amount', async () => {
    const onChange = vi.fn();
    await mount({ 'quest_template.RewardMoneyDifficulty': 0 }, onChange);
    expect(await screen.findByRole('option', { name: '0 — use the fixed amount above' })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /money reward tier/i }), '3 — 1 gold 50 silver');
    expect(onChange).toHaveBeenCalledWith('quest_template.RewardMoneyDifficulty', 3);
  });
  it('edits the fixed money as gold, silver and copper', async () => {
    const onChange = vi.fn();
    await mount({}, onChange);
    await userEvent.type(screen.getByLabelText('Gold'), '2');
    expect(onChange).toHaveBeenLastCalledWith('quest_template.RewardMoney', 20000);
  });
  it('lists reward and choice items and blocks a seventh choice', async () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ item: i + 1, quantity: 1 }));
    await mount({ 'quest_template.RewardChoiceItems': six });
    expect(screen.getByText(/at most 6/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add choice' })).toBeDisabled();
  });
  it('degrades gracefully when the reference tables are unavailable', async () => {
    const empty = makeMockApi({ rewardTables: async () => okv({ xp: Array(10).fill(null), money: Array(10).fill(null) }) });
    await mountBody('rewards', {}, { api: empty });
    expect(await screen.findByRole('option', { name: '0' })).toBeInTheDocument();
  });
});
