// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EntityList, changeSummary } from '../../src/renderer/entities/EntityList';
import type { TrackedEntity } from '../../src/core/entities/entity';

const none = { npcs: [], objects: [], items: [] };
const hela: TrackedEntity = { kind: 'npc', entry: 12000001, name: 'Hela', origin: 'new', changes: ['new'], usedBy: [60001, 60002], goTo: { kind: 'creature', guid: 6000001, map: 0, x: 1, y: 2, z: 3 } };
const guard: TrackedEntity = { kind: 'npc', entry: 1423, name: 'Stormwind Guard', origin: 'existing', changes: ['spawns', 'path'], usedBy: [], goTo: null };
const seal: TrackedEntity = { kind: 'item', entry: 9200001, name: 'Seal', origin: 'new', changes: ['new'], usedBy: [], goTo: null };
const quests = [{ questId: 60001, title: 'Wolves', uses: none, refs: none }, { questId: 60002, title: 'Second', uses: none, refs: none }];

describe('EntityList', () => {
  it('sums up what changed', () => {
    expect(changeSummary(['new'])).toBe('New');
    expect(changeSummary(['spawns', 'movement', 'path', 'details', 'group'])).toBe('Spawns changed · Movement changed · Path changed · Details changed · Group changed');
  });

  it('lists each entity with its kind, entry, changes and the quests that use it', () => {
    render(<EntityList tracked={[hela, guard, seal]} quests={quests} />);
    expect(within(screen.getByRole('listitem', { name: 'Hela' })).getByText('NPC 12000001 · New · used by Wolves, Second')).toBeTruthy();
    expect(within(screen.getByRole('listitem', { name: 'Stormwind Guard' })).getByText('NPC 1423 · Spawns changed · Path changed')).toBeTruthy();
    expect(within(screen.getByRole('listitem', { name: 'Seal' })).getByText('Item 9200001 · New')).toBeTruthy();
  });

  it('edits what can be edited and goes to what has a spawn', async () => {
    const onEdit = vi.fn();
    const onGoTo = vi.fn();
    render(<EntityList tracked={[hela, guard]} quests={quests} canEdit={(e) => e.origin === 'new'} onEdit={onEdit} onGoTo={onGoTo} />);
    const row = screen.getByRole('listitem', { name: 'Hela' });
    await userEvent.click(within(row).getByRole('button', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalledWith({ kind: 'npc', entry: 12000001 });
    await userEvent.click(within(row).getByRole('button', { name: 'Go to' }));
    expect(onGoTo).toHaveBeenCalledWith(hela);
    const other = screen.getByRole('listitem', { name: 'Stormwind Guard' });
    expect(within(other).getByRole('button', { name: 'Edit' })).toHaveProperty('disabled', true);
    expect(within(other).getByRole('button', { name: 'Go to' })).toHaveProperty('disabled', true);
  });

  it('with a quest open, puts its entities first and leaves it out of "used by"', () => {
    render(<EntityList tracked={[guard, hela, seal]} quests={quests} openQuestId={60001} />);
    const mine = screen.getByRole('region', { name: 'Used by this quest' });
    expect(within(mine).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['Hela']);
    expect(within(mine).getByText('NPC 12000001 · New · used by Second')).toBeTruthy();
    const others = screen.getByRole('region', { name: 'Others in the project' });
    expect(within(others).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['Stormwind Guard', 'Seal']);
  });
});
