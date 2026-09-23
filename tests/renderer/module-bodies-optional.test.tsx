// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MODULES } from '@core/modules/catalog';
import { MODULE_BODIES } from '../../src/renderer/modules/ModuleBody';
import { mountBody } from './module-harness';
import { makeMockApi, okv } from './mock-api';

describe('optional module bodies', () => {
  it('has a body for every module', () => {
    for (const m of MODULES) expect(MODULE_BODIES[m.id], m.id).toBeTypeOf('function');
  });

  it('Requirements: max level, skill and reputation dropdowns', async () => {
    const { onChange } = await mountBody('requirements');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Required skill' }), 'Mining');
    expect(onChange).toHaveBeenLastCalledWith('quest_template_addon.RequiredSkillID', 186);
    expect(screen.getByLabelText('Max level')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Minimum reputation with' })).toBeInTheDocument();
  });

  it('Chain: picks the previous quest by search', async () => {
    const api = makeMockApi({ searchEntities: vi.fn(async () => okv([{ id: 12, name: 'The Hunt', detail: 'Level 5' }])) });
    const { onChange } = await mountBody('chain', { 'quest_template_addon.PrevQuestID': 0 }, { api });
    await userEvent.type(screen.getByRole('combobox', { name: 'Previous quest' }), 'hunt');
    await userEvent.click(await screen.findByRole('option', { name: 'The Hunt · Level 5 · #12' }));
    expect(onChange).toHaveBeenLastCalledWith('quest_template_addon.PrevQuestID', 12);
  });

  it('Chain: a previous quest that must be in the log is stored negative', async () => {
    const { onChange } = await mountBody('chain', { 'quest_template_addon.PrevQuestID': 12 });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Previous quest must be' }), 'In the quest log');
    expect(onChange).toHaveBeenLastCalledWith('quest_template_addon.PrevQuestID', -12);
  });

  it('Timer: minutes and seconds write seconds', async () => {
    const { onChange } = await mountBody('timer', { 'quest_template.TimeAllowed': 0 });
    await userEvent.clear(screen.getByLabelText('Minutes'));
    await userEvent.type(screen.getByLabelText('Minutes'), '15');
    expect(onChange).toHaveBeenLastCalledWith('quest_template.TimeAllowed', 900);
  });

  it('Behaviour: named toggles flip one bit each', async () => {
    const { onChange } = await mountBody('behaviour', { 'quest_template.Flags': 8, 'quest_template_addon.SpecialFlags': 0 });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Daily quest' }));
    expect(onChange).toHaveBeenLastCalledWith('quest_template.Flags', 8 | 0x1000);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Repeatable' }));
    expect(onChange).toHaveBeenLastCalledWith('quest_template_addon.SpecialFlags', 1);
    expect(screen.getByText('All flags')).toBeInTheDocument();
  });

  it('Mail reward: the sender is picked by search', async () => {
    await mountBody('mail');
    expect(screen.getByRole('combobox', { name: 'Mail sender' })).toBeInTheDocument();
  });

  it('Extra rewards: talent points', async () => {
    const { onChange } = await mountBody('extraRewards');
    await userEvent.clear(screen.getByLabelText('Talent points'));
    await userEvent.type(screen.getByLabelText('Talent points'), '2');
    expect(onChange).toHaveBeenLastCalledWith('quest_template.RewardTalents', 2);
  });

  it('Map marker: shows the marker settings', async () => {
    await mountBody('mapMarker');
    expect(screen.getByLabelText('Marker priority')).toBeInTheDocument();
  });

  it('Advanced: raw controls for the leftover fields, and the unmodelled columns', async () => {
    await mountBody('advanced');
    expect(screen.getByLabelText(/Suggested players/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Unmodelled columns' })).toBeInTheDocument();
  });
});
