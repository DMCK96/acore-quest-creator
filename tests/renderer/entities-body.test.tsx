// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mountBody } from './module-harness';
import type { TrackedEntity } from '../../src/core/entities/entity';

const tr = (kind: 'npc' | 'object' | 'item', entry: number, name: string): TrackedEntity =>
  ({ kind, entry, name, origin: 'new', changes: ['new'], usedBy: [60001], goTo: null }) as TrackedEntity;
const tracked = [tr('npc', 12000001, 'Hela'), tr('object', 9100001, 'Crate'), tr('item', 990300, 'Pearl')];

describe('NPCs, objects & items module', () => {
  it('lists each tracked entity in one row with Edit', async () => {
    const openEditor = vi.fn(async () => null);
    await mountBody('entities', {}, { openEditor, tracked });
    const hela = screen.getByRole('listitem', { name: 'Hela' });
    expect(within(hela).getByText('NPC 12000001 · New')).toBeTruthy();
    await userEvent.click(within(hela).getByRole('button', { name: 'Edit' }));
    expect(openEditor).toHaveBeenCalledWith({ kind: 'npc', entry: 12000001 });
    const crate = screen.getByRole('listitem', { name: 'Crate' });
    await userEvent.click(within(crate).getByRole('button', { name: 'Edit' }));
    expect(openEditor).toHaveBeenCalledWith({ kind: 'object', entry: 9100001 });
    const pearl = screen.getByRole('listitem', { name: 'Pearl' });
    await userEvent.click(within(pearl).getByRole('button', { name: 'Edit' }));
    expect(openEditor).toHaveBeenCalledWith({ kind: 'item', entry: 990300 });
  });

  it('cannot edit an existing entity the project only changed', async () => {
    await mountBody('entities', {}, { openEditor: vi.fn(async () => null), tracked: [{ ...tr('npc', 5, 'Guard'), origin: 'existing', changes: ['spawns'] } as TrackedEntity] });
    expect(within(screen.getByRole('listitem', { name: 'Guard' })).getByRole('button', { name: 'Edit' }).hasAttribute('disabled')).toBe(true);
  });

  it('adds NPCs and objects through the one editor, with no copy picker', async () => {
    const openEditor = vi.fn(async () => null);
    await mountBody('entities', {}, { openEditor });
    expect(screen.queryByRole('combobox', { name: /Copy/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Add NPC' }));
    expect(openEditor).toHaveBeenCalledWith({ kind: 'newNpc' });
    await userEvent.click(screen.getByRole('button', { name: 'Add object' }));
    expect(openEditor).toHaveBeenCalledWith({ kind: 'newObject' });
  });

  it('says why when a new one cannot be made', async () => {
    await mountBody('entities', {}, { openEditor: vi.fn(async () => 'The database is not reachable.') });
    await userEvent.click(screen.getByRole('button', { name: 'Add NPC' }));
    expect(await screen.findByText('The database is not reachable.')).toBeTruthy();
  });

  it('adds items through the editor', async () => {
    const openEditor = vi.fn(async () => null);
    await mountBody('entities', {}, { openEditor });
    await userEvent.click(screen.getByRole('button', { name: 'Add item' }));
    expect(openEditor).toHaveBeenCalledWith({ kind: 'newItem' });
  });
});
