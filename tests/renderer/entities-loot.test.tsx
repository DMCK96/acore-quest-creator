// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mountBody } from './module-harness';
import { ENTITIES_FIELD, newObject, writeEntities, type QuestEntities } from '../../src/core/entities/model';

const last = (onChange: ReturnType<typeof vi.fn>) => onChange.mock.calls.filter(([f]) => f === ENTITIES_FIELD).at(-1)![1] as QuestEntities;

describe('loot in the editor', () => {
  it('adds a loot row to a chest and edits its chance', async () => {
    const onChange = vi.fn();
    const chest = { ...newObject(9100001), name: 'Chest', type: 'chest' as const };
    await mountBody('entities', { [ENTITIES_FIELD]: writeEntities({ npcs: [], objects: [chest] }) }, { onChange });
    const card = screen.getByRole('group', { name: 'Object: Chest' });
    await userEvent.click(within(card).getByRole('button', { name: 'Add loot' }));
    expect(last(onChange).objects[0]!.loot).toEqual([{ item: 0, chance: 100, min: 1, max: 1, questOnly: false }]);
  });
  it('offers no loot on a usable object', async () => {
    const lever = { ...newObject(9100002), name: 'Lever' };
    await mountBody('entities', { [ENTITIES_FIELD]: writeEntities({ npcs: [], objects: [lever] }) });
    expect(within(screen.getByRole('group', { name: 'Object: Lever' })).queryByRole('button', { name: 'Add loot' })).toBeNull();
  });
});
