// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mountBody } from './module-harness';
import { makeMockApi, okv } from './mock-api';
import { ENTITIES_FIELD, newNpc, writeEntities, type QuestEntities } from '../../src/core/entities/model';

const last = (onChange: ReturnType<typeof vi.fn>) => onChange.mock.calls.filter(([f]) => f === ENTITIES_FIELD).at(-1)![1] as QuestEntities;

describe('NPCs & objects module', () => {
  it('adds an NPC with a freshly allocated entry', async () => {
    const api = makeMockApi({ allocateIds: vi.fn(async () => okv([12000001])) });
    const onChange = vi.fn();
    await mountBody('entities', {}, { api, onChange });
    await userEvent.click(screen.getByRole('button', { name: 'Add NPC' }));
    await waitFor(() => expect(last(onChange).npcs).toHaveLength(1));
    expect(last(onChange).npcs[0]).toMatchObject({ entry: 12000001, name: '' });
    expect(api.allocateIds).toHaveBeenCalledWith('creature', 1);
  });

  it('copies look and stats when adding from an existing NPC', async () => {
    const api = makeMockApi({
      allocateIds: vi.fn(async () => okv([12000002])),
      entityTemplate: vi.fn(async () => okv({ name: 'Wolf', displayId: 903, minLevel: 5, maxLevel: 6 })),
      searchEntities: vi.fn(async () => okv([{ id: 299, name: 'Wolf' }])),
    });
    const onChange = vi.fn();
    await mountBody('entities', {}, { api, onChange });
    const copy = screen.getByRole('combobox', { name: 'Copy from (optional)' });
    await userEvent.type(copy, 'Wolf');
    await userEvent.click(await screen.findByRole('option', { name: /Wolf · #299/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Add NPC' }));
    await waitFor(() => expect(last(onChange).npcs[0]).toMatchObject({ entry: 12000002, name: 'Wolf', displayId: 903, minLevel: 5 }));
  });

  it('edits an NPC and adds a spawn from pasted .gps output', async () => {
    const api = makeMockApi({ allocateIds: vi.fn(async () => okv([6000001])) });
    const onChange = vi.fn();
    const entities: QuestEntities = { npcs: [{ ...newNpc(12000001), name: 'Hela' }], objects: [] };
    await mountBody('entities', { [ENTITIES_FIELD]: writeEntities(entities) }, { api, onChange });
    const card = screen.getByRole('group', { name: 'NPC: Hela' });
    await userEvent.clear(within(card).getByLabelText('Name'));
    await userEvent.type(within(card).getByLabelText('Name'), 'X');
    expect(last(onChange).npcs[0]!.name).toBe('X');
    await userEvent.click(within(card).getByRole('button', { name: 'Add spawn' }));
    await waitFor(() => expect(last(onChange).npcs[0]!.spawns).toHaveLength(1));
  });
});
