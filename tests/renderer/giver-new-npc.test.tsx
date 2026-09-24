// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mountBody } from './module-harness';
import { ENTITIES_FIELD, newNpc, newSpawn, writeEntities } from '../../src/core/entities/model';

describe('giver card: new NPCs and objects', () => {
  it('New NPC opens the one editor, and the card takes the NPC it made', async () => {
    const openEditor = vi.fn(async (req: any) => { req.onCreated?.(12000005); return null; });
    const { onChange } = await mountBody('giver', { creature_queststarter: [{ id: 0 }] }, { openEditor });
    await userEvent.click(screen.getByRole('button', { name: 'New NPC for starts at 1' }));
    expect(openEditor).toHaveBeenCalledWith(expect.objectContaining({ kind: 'newNpc', preset: { questGiver: true } }));
    expect(onChange).toHaveBeenCalledWith('creature_queststarter', [{ id: 12000005 }]);
  });

  it('New object on an object card makes a quest-giver object', async () => {
    const openEditor = vi.fn(async () => null);
    await mountBody('giver', { gameobject_queststarter: [{ id: 0 }] }, { openEditor });
    await userEvent.click(screen.getByRole('button', { name: 'New object for starts at 1' }));
    expect(openEditor).toHaveBeenCalledWith(expect.objectContaining({ kind: 'newObject', preset: { type: 'questGiver' } }));
  });

  it('says why when no NPC could be made', async () => {
    await mountBody('giver', { creature_queststarter: [{ id: 0 }] }, { openEditor: vi.fn(async () => 'The database is not reachable.') });
    await userEvent.click(screen.getByRole('button', { name: 'New NPC for starts at 1' }));
    expect(await screen.findByText('The database is not reachable.')).toBeTruthy();
  });

  it('shows a project NPC by name with Edit NPC, and no fields of its own', async () => {
    const openEditor = vi.fn(async () => null);
    const values = { creature_queststarter: [{ id: 12000005 }], [ENTITIES_FIELD]: writeEntities({ npcs: [{ ...newNpc(12000005), name: 'Hela' }], objects: [] }) };
    await mountBody('giver', values, { openEditor, openMap: vi.fn() });
    const card = screen.getByRole('region', { name: 'Starts at 1' });
    expect(within(card).queryByLabelText('NPC name')).toBeNull();
    expect(within(card).getByText('Made with this quest.')).toBeTruthy();
    await userEvent.click(within(card).getByRole('button', { name: 'Edit NPC' }));
    expect(openEditor).toHaveBeenCalledWith({ kind: 'npc', entry: 12000005 });
    expect(within(card).getByRole('button', { name: 'Place on map' })).toBeTruthy();
  });

  it('shows a placed NPC on the map and offers its patrol', async () => {
    const openMap = vi.fn();
    const npc = { ...newNpc(12000005), name: 'Hela', spawns: [{ ...newSpawn(900), x: 1, y: 2 }] };
    await mountBody('giver', { creature_queststarter: [{ id: 12000005 }], [ENTITIES_FIELD]: writeEntities({ npcs: [npc], objects: [] }) }, { openMap });
    const card = screen.getByRole('region', { name: 'Starts at 1' });
    await userEvent.click(within(card).getByRole('button', { name: 'Show on map' }));
    expect(openMap).toHaveBeenCalledWith('spawn:npc:12000005:900');
    await userEvent.click(within(card).getByRole('button', { name: 'Draw patrol' }));
    expect(openMap).toHaveBeenCalledWith({ kind: 'patrol', entry: 12000005, guid: 900 });
  });

  it('shows no name field or map buttons for an NPC already in the world', async () => {
    await mountBody('giver', { creature_queststarter: [{ id: 240 }] }, { openMap: vi.fn() });
    const card = screen.getByRole('region', { name: 'Starts at 1' });
    expect(within(card).queryByLabelText('NPC name')).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Place on map' })).toBeNull();
  });

  it('offers New object, not New NPC, on an object card', async () => {
    await mountBody('giver', { gameobject_queststarter: [{ id: 0 }] }, { openEditor: vi.fn(async () => null) });
    expect(screen.queryByRole('button', { name: 'New NPC for starts at 1' })).toBeNull();
    expect(screen.getByRole('button', { name: 'New object for starts at 1' })).toBeTruthy();
  });
});
