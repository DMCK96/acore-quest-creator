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
    expect(await screen.findByRole('option', { name: '300 XP (tier 2)' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /XP reward/i })).toHaveDisplayValue('300 XP (tier 2)');
  });
  it('explains that the XP depends on player level when the quest level is not fixed', async () => {
    await mount({ 'quest_template.QuestLevel': -1 });
    expect(await screen.findByText(/depends on the player's level/i)).toBeInTheDocument();
  });
  it('shows only the fixed amount for a quest with a fixed level, whatever the tier column holds', async () => {
    await mount({ 'quest_template.RewardMoneyDifficulty': 24750 });
    expect(screen.getByLabelText('Gold')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByText(/24750/)).toBeNull();
  });
  it('offers scaling money for a quest any level can do', async () => {
    const onChange = vi.fn();
    await mount({ 'quest_template.QuestLevel': -1, 'quest_template.RewardMoneyDifficulty': 0 }, onChange);
    expect(screen.getByRole('radio', { name: 'A fixed amount' })).toBeChecked();
    expect(screen.getByLabelText('Gold')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: "Scales with the player's level" }));
    expect(onChange).toHaveBeenCalledWith('quest_template.RewardMoneyDifficulty', 5);
  });
  it('shows what a scaling tier pays across the level range', async () => {
    const byLevel = makeMockApi({ rewardTables: async (level: number) => okv({ xp, money: money.map((_, n) => level * 100 * n) }) });
    const onChange = vi.fn();
    await mountBody('rewards', { 'quest_template.QuestLevel': -1, 'quest_template.RewardMoneyDifficulty': 5 }, { api: byLevel, onChange });
    expect(screen.getByRole('radio', { name: "Scales with the player's level" })).toBeChecked();
    expect(screen.queryByLabelText('Gold')).toBeNull();
    expect(await screen.findByText('Pays 50s at level 10, 2g at level 40, 3g at level 60, 4g at level 80.')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Reward size' }), 'Tier 3: up to 2g 40s');
    expect(onChange).toHaveBeenCalledWith('quest_template.RewardMoneyDifficulty', 3);
  });
  it('keeps showing a real tier on a fixed-level quest, since the server scales it', async () => {
    await mount({ 'quest_template.RewardMoneyDifficulty': 3 });
    expect(screen.getByRole('radio', { name: "Scales with the player's level" })).toBeChecked();
  });
  it('never offers scaling for money taken from the player', async () => {
    await mount({ 'quest_template.QuestLevel': -1, 'quest_template.RewardMoney': -500 });
    expect(screen.queryByRole('radio')).toBeNull();
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
    expect(await screen.findByRole('option', { name: 'Tier 1' })).toBeInTheDocument();
  });
});
