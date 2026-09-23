// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mountBody } from './module-harness';

const kills = (n: number) => Array.from({ length: n }, (_, i) => ({ target: { target: 'creature' as const, id: i + 1 }, count: 1 }));

describe('Objectives body', () => {
  it('adds a kill objective', async () => {
    const { onChange } = await mountBody('objectives');
    await userEvent.click(screen.getByRole('button', { name: 'Add kill or use' }));
    expect(onChange).toHaveBeenCalledWith('quest_template.RequiredNpcOrGo', [{ target: { target: 'creature', id: 0 }, count: 1 }]);
  });
  it('stops at four kill objectives on an imported quest', async () => {
    await mountBody('objectives', { 'quest_template.RequiredNpcOrGo': kills(4) });
    expect(screen.getByRole('button', { name: 'Add kill or use' })).toBeDisabled();
    expect(screen.getByText('A quest can have at most 4 kill or use targets.')).toBeInTheDocument();
  });
  it('adds a collect objective and shows its drop sources', async () => {
    const { onChange } = await mountBody('objectives', { 'quest_template.RequiredItems': [{ item: 750, count: 5 }] });
    expect(screen.getByRole('heading', { name: 'Drop sources' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add collect' }));
    expect(onChange).toHaveBeenCalledWith('quest_template.RequiredItems', [{ item: 750, count: 5 }, { item: 0, count: 1 }]);
  });
  it('adds an explore objective as an area trigger', async () => {
    const { onChange } = await mountBody('objectives');
    await userEvent.click(screen.getByRole('button', { name: 'Add explore' }));
    expect(onChange).toHaveBeenCalledWith('areatrigger_involvedrelation', [{ id: 0 }]);
  });
  it('asks for the blank explore card to be filled before adding another', async () => {
    await mountBody('objectives', { areatrigger_involvedrelation: [{ id: 0 }] });
    expect(screen.getByRole('button', { name: 'Add explore' })).toBeDisabled();
  });
  it('edits the objectives summary line', async () => {
    const { onChange } = await mountBody('objectives');
    await userEvent.type(screen.getByLabelText('Objectives summary'), 'K');
    expect(onChange).toHaveBeenLastCalledWith('quest_template.LogDescription', 'K');
  });
});

describe('Rewards body', () => {
  it('shows XP and money settings', async () => {
    await mountBody('rewards');
    expect(screen.getByRole('combobox', { name: /XP reward/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Gold')).toBeInTheDocument();
  });
  it('adds reward items, choices and reputation', async () => {
    const { onChange } = await mountBody('rewards');
    await userEvent.click(screen.getByRole('button', { name: 'Add reward item' }));
    expect(onChange).toHaveBeenCalledWith('quest_template.RewardItems', [{ item: 0, amount: 1 }]);
    await userEvent.click(screen.getByRole('button', { name: 'Add choice' }));
    expect(onChange).toHaveBeenCalledWith('quest_template.RewardChoiceItems', [{ item: 0, quantity: 1 }]);
    await userEvent.click(screen.getByRole('button', { name: 'Add reputation' }));
    expect(onChange).toHaveBeenCalledWith('quest_template.RewardFactions', [{ faction: 0, value: 0, override: 0 }]);
  });
  it('picks the reputation faction from a dropdown', async () => {
    const { onChange } = await mountBody('rewards', { 'quest_template.RewardFactions': [{ faction: 0, value: 0, override: 0 }] });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /Faction 1/ }), 'Argent Dawn');
    expect(onChange).toHaveBeenLastCalledWith('quest_template.RewardFactions', [{ faction: 529, value: 0, override: 0 }]);
  });
});
