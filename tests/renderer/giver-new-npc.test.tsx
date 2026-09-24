// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mountBody } from './module-harness';
import { makeMockApi, okv, errv } from './mock-api';
import { ENTITIES_FIELD, newNpc, newSpawn, readEntities, writeEntities } from '../../src/core/entities/model';

const entitiesOf = (onChange: ReturnType<typeof vi.fn>) =>
  readEntities({ [ENTITIES_FIELD]: onChange.mock.calls.filter(([f]) => f === ENTITIES_FIELD).at(-1)![1] });

describe('giver card: new NPC', () => {
  it('makes a new quest-giving NPC and puts it on the card', async () => {
    const api = makeMockApi({ allocateIds: vi.fn(async () => okv([12000005])) });
    const { onChange } = await mountBody('giver', { creature_queststarter: [{ id: 0 }] }, { api });
    await userEvent.click(screen.getByRole('button', { name: 'New NPC for starts at 1' }));
    expect(api.allocateIds).toHaveBeenCalledWith('creature', 1);
    expect(entitiesOf(onChange).npcs).toEqual([expect.objectContaining({ entry: 12000005, questGiver: true, name: '' })]);
    expect(onChange).toHaveBeenCalledWith('creature_queststarter', [{ id: 12000005 }]);
  });

  it('says why when no NPC id could be had', async () => {
    const api = makeMockApi({ allocateIds: vi.fn(async () => errv('CONNECTION', 'The database is not reachable.')) });
    const { onChange } = await mountBody('giver', { creature_queststarter: [{ id: 0 }] }, { api });
    await userEvent.click(screen.getByRole('button', { name: 'New NPC for starts at 1' }));
    expect(await screen.findByText('The database is not reachable.')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('names a project NPC on the card and offers to place it', async () => {
    const openMap = vi.fn();
    const values = { creature_queststarter: [{ id: 12000005 }], [ENTITIES_FIELD]: writeEntities({ npcs: [{ ...newNpc(12000005), questGiver: true }], objects: [] }) };
    const { onChange } = await mountBody('giver', values, { openMap });
    const card = screen.getByRole('region', { name: 'Starts at 1' });
    expect(within(card).getByText('Made with this quest. Set its level, model and more in NPCs & objects.')).toBeTruthy();
    await userEvent.type(within(card).getByLabelText('NPC name'), 'H');
    expect(entitiesOf(onChange).npcs[0]!.name).toBe('H');
    await userEvent.click(within(card).getByRole('button', { name: 'Place on map' }));
    expect(openMap).toHaveBeenCalledWith({ kind: 'place', target: { kind: 'npc', entry: 12000005 } });
    expect(within(card).queryByRole('button', { name: 'Draw patrol' })).toBeNull();
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

  it('offers no new NPC on an object card', async () => {
    await mountBody('giver', { gameobject_queststarter: [{ id: 0 }] });
    expect(screen.queryByRole('button', { name: 'New NPC for starts at 1' })).toBeNull();
  });
});
