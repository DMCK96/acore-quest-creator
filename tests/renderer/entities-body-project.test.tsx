// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mountBody } from './module-harness';
import { EMPTY_ENTITIES, newItem, newNpc, newObject } from '../../src/core/entities/model';
import { MODULES } from '../../src/core/modules/catalog';
import { entitiesSummary } from '../../src/core/modules/summaries';
import { presentModules } from '../../src/core/modules/catalog';

const store = { ...EMPTY_ENTITIES,
  npcs: [{ ...newNpc(12000001), name: 'Hela' }, { ...newNpc(12000002), name: 'Borin' }, { ...newNpc(12000003), name: 'Vendor' }],
  objects: [{ ...newObject(9100001), name: 'Crate' }], items: [{ ...newItem(9200001), name: 'Seal' }] };
const others = [{ questId: 60002, title: 'Second', uses: { npcs: [12000002], objects: [], items: [] } }];

describe('the quest\'s NPCs, objects & items over the project store', () => {
  it('lists what the quest names, with the other quests that use each', async () => {
    await mountBody('entities', { creature_queststarter: [{ id: 12000001 }], creature_questender: [{ id: 12000002 }] }, { entities: store, quests: others });
    expect(screen.getByRole('listitem', { name: 'Hela' })).toBeTruthy();
    const borin = screen.getByRole('listitem', { name: 'Borin' });
    expect(within(borin).getByText('Also used by Second')).toBeTruthy();
    expect(screen.queryByRole('listitem', { name: 'Vendor' })).toBeNull();
  });

  it('adds a project NPC as the quest\'s giver from Add from project', async () => {
    const onChange = vi.fn();
    await mountBody('entities', {}, { entities: store, quests: others, onChange });
    await userEvent.click(screen.getByRole('button', { name: 'Add from project…' }));
    const dialog = screen.getByRole('dialog', { name: 'Add from the project' });
    await userEvent.click(within(dialog).getByRole('option', { name: /Vendor/ }));
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Giver' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(onChange).toHaveBeenCalledWith('creature_queststarter', [{ id: 12000003 }]);
  });

  it('adds a project item as a required item', async () => {
    const onChange = vi.fn();
    await mountBody('entities', {}, { entities: store, quests: [], onChange });
    await userEvent.click(screen.getByRole('button', { name: 'Add from project…' }));
    const dialog = screen.getByRole('dialog', { name: 'Add from the project' });
    await userEvent.click(within(dialog).getByRole('option', { name: /Seal/ }));
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Required item' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(onChange).toHaveBeenCalledWith('quest_template.RequiredItems', expect.arrayContaining([expect.objectContaining({ item: 9200001, count: 1 })]));
  });

  it('makes new ones with no quest attached', async () => {
    const openEditor = vi.fn(async () => null);
    await mountBody('entities', {}, { entities: store, quests: [], openEditor });
    await userEvent.click(screen.getByRole('button', { name: 'Add NPC' }));
    expect(openEditor).toHaveBeenCalledWith({ kind: 'newNpc' });
  });
});

describe('the module in the quest', () => {
  it('owns no quest field, is shown when the quest uses something, and sums up what it uses', () => {
    expect(MODULES.find((m) => m.id === 'entities')!.owns).toEqual([]);
    expect(presentModules({}, [], store)).toContain('entities');
    expect(presentModules({}, [], EMPTY_ENTITIES)).not.toContain('entities');
    expect(entitiesSummary({}, { creature: {}, gameobject: {}, item: {} } as never, store)).toEqual(['3 NPCs, 1 object, 1 item', 'Hela', 'Borin']);
  });
});
