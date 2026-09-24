// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mountEditor } from './module-harness';
import { makeMockApi, okv } from './mock-api';
import { ENTITIES_FIELD, newObject, writeEntities, type QuestEntities } from '../../src/core/entities/model';

const last = (onChange: ReturnType<typeof vi.fn>) => onChange.mock.calls.filter(([f]) => f === ENTITIES_FIELD).at(-1)![1] as QuestEntities;

describe('object pages in the editor', () => {
  it('adds a page with a fresh id to a readable object', async () => {
    const api = makeMockApi({ allocateIds: vi.fn(async () => okv([5001])) });
    const onChange = vi.fn();
    const note = { ...newObject(9100001), name: 'Note', type: 'text' as const };
    await mountEditor({ [ENTITIES_FIELD]: writeEntities({ npcs: [], objects: [note] }) }, { kind: 'object', entry: 9100001, isNew: false }, { api, onChange, tab: 'Contents' });
    const card = screen.getByRole('dialog', { name: 'Object: Note' });
    await userEvent.click(within(card).getByRole('button', { name: 'Add page' }));
    await waitFor(() => expect(last(onChange).objects[0]!.pages).toEqual([{ id: 5001, text: '' }]));
    expect(api.allocateIds).toHaveBeenCalledWith('page', 1);
  });
  it('limits a usable object to the quest', async () => {
    const onChange = vi.fn();
    const lever = { ...newObject(9100002), name: 'Lever' };
    await mountEditor({ [ENTITIES_FIELD]: writeEntities({ npcs: [], objects: [lever] }) }, { kind: 'object', entry: 9100002, isNew: false }, { onChange });
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Object: Lever' })).getByLabelText('Only usable while this quest is in the log'));
    expect(last(onChange).objects[0]!.onlyDuringQuest).toBe(true);
  });
});
