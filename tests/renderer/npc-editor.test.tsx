// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NpcEditor } from '../../src/renderer/entities/npc/NpcEditor';
import { NamesProvider } from '../../src/renderer/state/names';
import { makeMockApi, okv } from './mock-api';
import { newNpc, type CustomNpc } from '../../src/core/entities/model';
import type { Api } from '@shared/ipc';

let current: CustomNpc = newNpc(12000001);
function Live({ api, start }: { api: Api; start: CustomNpc }) {
  const [npc, setNpc] = useState(start);
  current = npc;
  return <NamesProvider api={api}><NpcEditor npc={npc} onChange={(n) => { current = n; setNpc(n); }} allocateSpawn={async () => 900} /></NamesProvider>;
}
const tab = (name: string) => userEvent.click(screen.getByRole('tab', { name }));

describe('NPC editor', () => {
  it('has the five tabs and opens on Basics', async () => {
    render(<Live api={makeMockApi()} start={newNpc(12000001)} />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Basics', 'Look & gear', 'Fight', 'Loot', 'Placement']);
    expect(screen.getByRole('tab', { name: 'Basics' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Basics' })).toBeTruthy();
  });

  it('edits who it is on Basics, with a common faction in one click', async () => {
    render(<Live api={makeMockApi()} start={newNpc(12000001)} />);
    await userEvent.type(screen.getByLabelText('Name'), 'Hela');
    await userEvent.type(screen.getByLabelText('Title'), 'Guard');
    await userEvent.clear(screen.getByLabelText('Max level'));
    await userEvent.type(screen.getByLabelText('Max level'), '12');
    await userEvent.click(screen.getByRole('button', { name: 'Stormwind' }));
    await userEvent.selectOptions(screen.getByLabelText('Rank'), 'Elite');
    expect(current).toMatchObject({ name: 'Hela', subname: 'Guard', maxLevel: 12, faction: 11, rank: 'elite' });
  });

  it('takes the look and weapons of an existing NPC', async () => {
    const api = makeMockApi({
      searchEntities: vi.fn(async () => okv([{ id: 68, name: 'Stormwind City Guard' }])),
      entityTemplate: vi.fn(async () => okv({ displayId: 3167, scale: 1.1, equipment: { mainHand: 1899, offHand: 143, ranged: 0 } })),
    });
    render(<Live api={api} start={newNpc(12000001)} />);
    await tab('Look & gear');
    await userEvent.type(screen.getByRole('combobox', { name: 'Look like…' }), 'guard');
    await userEvent.click(await screen.findByRole('option', { name: /Stormwind City Guard/ }));
    await waitFor(() => expect(current).toMatchObject({ displayId: 3167, scale: 1.1, equipment: { mainHand: 1899, offHand: 143, ranged: 0 } }));
    expect(api.entityTemplate).toHaveBeenCalledWith('creature', 68);
    expect(screen.getByText('Armour comes with the look; only weapons are items.')).toBeTruthy();
  });

  it('look like clears weapons the source does not have, and keeps them when told to', async () => {
    const api = makeMockApi({
      searchEntities: vi.fn(async () => okv([{ id: 299, name: 'Wolf' }])),
      entityTemplate: vi.fn(async () => okv({ displayId: 903, scale: 1, equipment: { mainHand: 0, offHand: 0, ranged: 0 } })),
    });
    render(<Live api={api} start={{ ...newNpc(12000001), equipment: { mainHand: 5, offHand: 6, ranged: 7 } }} />);
    await tab('Look & gear');
    await userEvent.click(screen.getByLabelText('and its weapons'));
    await userEvent.type(screen.getByRole('combobox', { name: 'Look like…' }), 'wolf');
    await userEvent.click(await screen.findByRole('option', { name: /Wolf/ }));
    await waitFor(() => expect(current.displayId).toBe(903));
    expect(current.equipment).toEqual({ mainHand: 5, offHand: 6, ranged: 7 });
    await userEvent.click(screen.getByLabelText('and its weapons'));
    await userEvent.clear(screen.getByRole('combobox', { name: 'Look like…' }));
    await userEvent.type(screen.getByRole('combobox', { name: 'Look like…' }), 'wolf');
    await userEvent.click(await screen.findByRole('option', { name: /Wolf/ }));
    await waitFor(() => expect(current.equipment).toEqual({ mainHand: 0, offHand: 0, ranged: 0 }));
  });

  it('picks a look by browsing, or by display id, and names it', async () => {
    const api = makeMockApi({
      searchEntities: vi.fn(async (kind: string) => okv(kind === 'creatureDisplay' ? [{ id: 3167, name: 'Human male · armoured', detail: 'used by Stormwind City Guard' }] : [])),
      lookupNames: vi.fn(async (kind: string, ids: number[]) => okv(kind === 'creatureDisplay' && ids.includes(3167) ? { 3167: 'Human male · armoured' } : {})),
    });
    render(<Live api={api} start={newNpc(12000001)} />);
    await tab('Look & gear');
    await userEvent.click(screen.getByRole('button', { name: 'Other ways' }));
    await userEvent.type(screen.getByRole('combobox', { name: 'Browse models' }), 'human');
    await userEvent.click(await screen.findByRole('option', { name: /Human male · armoured/ }));
    expect(current.displayId).toBe(3167);
    expect(await screen.findByText('Looks like: Human male · armoured (display 3167)')).toBeTruthy();
    await userEvent.clear(screen.getByLabelText('Display ID'));
    await userEvent.type(screen.getByLabelText('Display ID'), '9');
    expect(current.displayId).toBe(9);
  });

  it('names a display the files do not know', async () => {
    render(<Live api={makeMockApi()} start={{ ...newNpc(12000001), displayId: 424242 }} />);
    await tab('Look & gear');
    expect(await screen.findByText('Looks like: Display 424242 (not in the server\'s data)')).toBeTruthy();
  });

  it('picks weapons by item name', async () => {
    const api = makeMockApi({ searchEntities: vi.fn(async (kind: string) => okv(kind === 'item' ? [{ id: 1899, name: 'Guard Sword' }] : [])) });
    render(<Live api={api} start={newNpc(12000001)} />);
    await tab('Look & gear');
    await userEvent.type(screen.getByRole('combobox', { name: 'Main hand' }), 'sword');
    await userEvent.click(await screen.findByRole('option', { name: /Guard Sword/ }));
    expect(current.equipment.mainHand).toBe(1899);
  });

  it('keeps fight, loot and placement on their own tabs', async () => {
    render(<Live api={makeMockApi()} start={{ ...newNpc(12000001), name: 'Hela' }} />);
    await tab('Fight');
    expect(screen.getByRole('region', { name: 'Fight' })).toBeTruthy();
    expect(screen.getByLabelText('Health multiplier')).toBeTruthy();
    await tab('Loot');
    expect(screen.getByRole('button', { name: 'Add loot' })).toBeTruthy();
    await tab('Placement');
    await userEvent.click(screen.getByRole('button', { name: 'Add spawn' }));
    await waitFor(() => expect(current.spawns).toHaveLength(1));
  });
});
