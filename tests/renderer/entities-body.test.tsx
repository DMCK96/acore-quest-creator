// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mountBody } from './module-harness';
import { ENTITIES_FIELD, newNpc, newObject, newSpawn, writeEntities } from '../../src/core/entities/model';

const values = { [ENTITIES_FIELD]: writeEntities({ npcs: [{ ...newNpc(12000001), name: 'Hela', minLevel: 10, maxLevel: 12, spawns: [newSpawn(900)] }], objects: [{ ...newObject(9100001), name: 'Crate' }] }) };

describe('NPCs & objects module', () => {
  it('lists each NPC and object in one row with Edit', async () => {
    const openEditor = vi.fn(async () => null);
    await mountBody('entities', values, { openEditor });
    const hela = screen.getByRole('listitem', { name: 'Hela' });
    expect(within(hela).getByText('Level 10–12 · placed')).toBeTruthy();
    const crate = screen.getByRole('listitem', { name: 'Crate' });
    expect(within(crate).getByText('Usable object · not placed')).toBeTruthy();
    await userEvent.click(within(hela).getByRole('button', { name: 'Edit' }));
    expect(openEditor).toHaveBeenCalledWith({ kind: 'npc', entry: 12000001 });
    await userEvent.click(within(crate).getByRole('button', { name: 'Edit' }));
    expect(openEditor).toHaveBeenCalledWith({ kind: 'object', entry: 9100001 });
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
});
