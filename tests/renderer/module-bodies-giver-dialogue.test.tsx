// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mountBody } from './module-harness';
import { makeMockApi, okv } from './mock-api';

describe('Quest Giver body', () => {
  it('adds a quest giver', async () => {
    const { onChange } = await mountBody('giver');
    await userEvent.click(screen.getByRole('button', { name: 'Add quest giver' }));
    expect(onChange).toHaveBeenCalledWith('creature_queststarter', [{ id: 0 }]);
  });

  it('picks the NPC for an existing card by searching', async () => {
    const api = makeMockApi({ searchEntities: vi.fn(async () => okv([{ id: 240, name: 'Marshal Dughan' }])) });
    const { onChange } = await mountBody('giver', { creature_queststarter: [{ id: 0 }] }, { api });
    await userEvent.type(screen.getByRole('combobox', { name: 'Starts at 1' }), 'dughan');
    await userEvent.click(await screen.findByRole('option', { name: 'Marshal Dughan · #240' }));
    expect(onChange).toHaveBeenCalledWith('creature_queststarter', [{ id: 240 }]);
    expect(onChange).toHaveBeenCalledWith('gameobject_queststarter', []);
  });

  it('switches a card from NPC to object', async () => {
    const { onChange } = await mountBody('giver', { creature_questender: [{ id: 240 }] });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Ends at kind 1' }), 'Object');
    expect(onChange).toHaveBeenCalledWith('creature_questender', []);
    expect(onChange).toHaveBeenCalledWith('gameobject_questender', [{ id: 0 }]);
  });

  it('asks for the blank card to be filled before adding another', async () => {
    await mountBody('giver', { creature_queststarter: [{ id: 0 }] });
    expect(screen.getByRole('button', { name: 'Add quest giver' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add quest ender' })).toBeEnabled();
  });

  it('removes a card', async () => {
    const { onChange } = await mountBody('giver', { creature_queststarter: [{ id: 240 }, { id: 241 }] });
    await userEvent.click(screen.getByRole('button', { name: 'Remove starts at 1' }));
    expect(onChange).toHaveBeenCalledWith('creature_queststarter', [{ id: 241 }]);
  });

  it('picks a start item by search and lists how the quest starts', async () => {
    await mountBody('giver');
    expect(screen.getByRole('combobox', { name: 'Started by item' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'How this quest starts' })).toBeInTheDocument();
  });
});

describe('Dialogue body', () => {
  it('edits the offer and turn-in texts', async () => {
    const { onChange } = await mountBody('dialogue');
    await userEvent.type(screen.getByLabelText('Offer text'), 'H');
    expect(onChange).toHaveBeenLastCalledWith('quest_template.QuestDescription', 'H');
    await userEvent.type(screen.getByLabelText('Turn-in text'), 'T');
    expect(onChange).toHaveBeenLastCalledWith('quest_offer_reward.RewardText', 'T');
  });
  it('shows progress text, the log line and emote pickers', async () => {
    await mountBody('dialogue');
    expect(screen.getByLabelText('Progress text')).toBeInTheDocument();
    expect(screen.getByLabelText('Completion log line')).toBeInTheDocument();
    expect(screen.getByLabelText('Emote when finished')).toBeInTheDocument();
    expect(screen.getByLabelText('Emote while unfinished')).toBeInTheDocument();
  });
});
