// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mountEditor } from './module-harness';
import { ENTITIES_FIELD, newObject, writeEntities, type QuestEntities } from '../../src/core/entities/model';

const last = (onChange: ReturnType<typeof vi.fn>) => onChange.mock.calls.filter(([f]) => f === ENTITIES_FIELD).at(-1)![1] as QuestEntities;

describe('loot in the editor', () => {
  it('adds a loot row to a chest and edits its chance', async () => {
    const onChange = vi.fn();
    const chest = { ...newObject(9100001), name: 'Chest', type: 'chest' as const };
    await mountEditor({ [ENTITIES_FIELD]: writeEntities({ npcs: [], objects: [chest] }) }, { kind: 'object', entry: 9100001, isNew: false }, { onChange, tab: 'Contents' });
    const card = screen.getByRole('dialog', { name: 'Object: Chest' });
    await userEvent.click(within(card).getByRole('button', { name: 'Add loot' }));
    expect(last(onChange).objects[0]!.loot).toEqual([{ item: 0, chance: 100, min: 1, max: 1, questOnly: false }]);
  });
  it('offers no loot on a usable object', async () => {
    const lever = { ...newObject(9100002), name: 'Lever' };
    await mountEditor({ [ENTITIES_FIELD]: writeEntities({ npcs: [], objects: [lever] }) }, { kind: 'object', entry: 9100002, isNew: false }, { tab: 'Contents' });
    expect(within(screen.getByRole('dialog', { name: 'Object: Lever' })).queryByRole('button', { name: 'Add loot' })).toBeNull();
  });
});
