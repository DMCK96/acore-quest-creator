// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NpcEditor } from '../../src/renderer/entities/npc/NpcEditor';
import { NamesProvider } from '../../src/renderer/state/names';
import { makeMockApi, okv } from './mock-api';
import { newNpc, type CustomNpc, type VendorItem } from '../../src/core/entities/model';

let current: CustomNpc = newNpc(12000001);
function Live({ start, hasServerData = true, api = makeMockApi() }: { start: CustomNpc; hasServerData?: boolean; api?: ReturnType<typeof makeMockApi> }) {
  const [npc, setNpc] = useState(start);
  current = npc;
  return <NamesProvider api={api}><NpcEditor npc={npc} onChange={(n) => { current = n; setNpc(n); }} allocateSpawn={async () => 900} hasServerData={hasServerData} tab="vendor" /></NamesProvider>;
}
const stock = (item: number, over: Partial<VendorItem> = {}): VendorItem => ({ item, maxCount: 0, restockSecs: 0, extendedCost: 0, ...over });
const withStock = (vendor: VendorItem[]): CustomNpc => ({ ...newNpc(12000001), name: 'Hela', vendor });
const rows = () => screen.getAllByRole('listitem');
const chooseSource = async (name: string) => {
  await userEvent.type(screen.getByRole('combobox', { name: 'Copy stock from…' }), name.toLowerCase());
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(name) }));
  await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
};

describe('the Vendor tab', () => {
  it('starts with an empty state that makes the NPC a vendor with one blank row', async () => {
    render(<Live start={newNpc(12000001)} />);
    await userEvent.click(screen.getByRole('button', { name: 'Make this NPC a vendor' }));
    expect(current.vendor).toEqual([stock(0)]);
  });

  it('adds, edits and removes rows', async () => {
    render(<Live start={withStock([stock(159)])} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add item' }));
    expect(current.vendor).toHaveLength(2);
    const second = rows()[1]!;
    const max = within(second).getByLabelText('Max count');
    await userEvent.clear(max);
    await userEvent.type(max, '5');
    const restock = within(second).getByLabelText('Restock (seconds)');
    await userEvent.clear(restock);
    await userEvent.type(restock, '900');
    expect(current.vendor[1]).toMatchObject({ maxCount: 5, restockSecs: 900 });
    await userEvent.click(within(rows()[0]!).getByRole('button', { name: 'Remove' }));
    expect(current.vendor).toHaveLength(1);
    expect(current.vendor[0]).toMatchObject({ maxCount: 5 });
  });

  it('never takes a count below zero or with a fraction', async () => {
    render(<Live start={withStock([stock(159, { maxCount: 4 })])} />);
    const max = within(rows()[0]!).getByLabelText('Max count');
    fireEvent.change(max, { target: { value: '-3' } });
    expect(current.vendor[0]!.maxCount).toBe(0);
    fireEvent.change(max, { target: { value: '2.6' } });
    expect(current.vendor[0]!.maxCount).toBe(3);
  });

  it('disables the restock time while stock is unlimited', () => {
    render(<Live start={withStock([stock(159, { maxCount: 0 })])} />);
    expect(within(rows()[0]!).getByLabelText('Restock (seconds)')).toBeDisabled();
  });

  it('reorders rows', async () => {
    render(<Live start={withStock([stock(1), stock(2), stock(3)])} />);
    expect(within(rows()[0]!).getByRole('button', { name: 'Up' })).toBeDisabled();
    expect(within(rows()[2]!).getByRole('button', { name: 'Down' })).toBeDisabled();
    await userEvent.click(within(rows()[0]!).getByRole('button', { name: 'Down' }));
    expect(current.vendor.map((v) => v.item)).toEqual([2, 1, 3]);
    await userEvent.click(within(rows()[2]!).getByRole('button', { name: 'Up' }));
    expect(current.vendor.map((v) => v.item)).toEqual([2, 3, 1]);
  });

  it('picks an extended cost by name', async () => {
    const api = makeMockApi({
      searchEntities: vi.fn(async (kind: string) => okv(kind === 'extendedCost' ? [{ id: 77, name: '2000 honor + 1 Mark of Honor' }] : [])),
    });
    render(<Live start={withStock([stock(159)])} api={api} />);
    await userEvent.type(screen.getByRole('combobox', { name: 'Extended cost' }), 'mark');
    await userEvent.click(await screen.findByRole('option', { name: /2000 honor/ }));
    expect(current.vendor[0]!.extendedCost).toBe(77);
  });

  it('takes an extended cost as a number without the server data folder', async () => {
    render(<Live start={withStock([stock(159)])} hasServerData={false} />);
    const field = screen.getByLabelText('Extended cost (id)');
    await userEvent.clear(field);
    await userEvent.type(field, '12');
    expect(current.vendor[0]!.extendedCost).toBe(12);
    expect(screen.getByText(/need the server data folder/i)).toBeTruthy();
  });

  it("shows an item's buy price", async () => {
    const api = makeMockApi({ entityTemplate: vi.fn(async () => okv({ name: 'Linen Cloth', displayId: 1, itemClass: 7, subclass: 5, inventoryType: 0, buyPrice: 12050 })) });
    render(<Live start={withStock([stock(2589)])} api={api} />);
    expect(await screen.findByText('Buy price: 1g 20s 50c')).toBeTruthy();
  });

  it("copies another NPC's stock in, asking before it replaces any", async () => {
    const api = makeMockApi({
      readExistingEntity: vi.fn(async () => okv({ ...newNpc(68), name: 'Guard', vendor: [stock(10), stock(11)] })),
      searchEntities: vi.fn(async () => okv([{ id: 68, name: 'Guard' }])),
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<Live start={withStock([stock(1)])} api={api} />);
    await chooseSource('Guard');
    expect(confirm).toHaveBeenCalled();
    expect(current.vendor.map((v) => v.item)).toEqual([10, 11]);
  });

  it('keeps its own stock when the author declines the replacement', async () => {
    const api = makeMockApi({
      readExistingEntity: vi.fn(async () => okv({ ...newNpc(68), name: 'Guard', vendor: [stock(10)] })),
      searchEntities: vi.fn(async () => okv([{ id: 68, name: 'Guard' }])),
    });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<Live start={withStock([stock(1)])} api={api} />);
    await chooseSource('Guard');
    expect(current.vendor.map((v) => v.item)).toEqual([1]);
  });

  it('copies into an NPC with no stock without asking', async () => {
    const api = makeMockApi({
      readExistingEntity: vi.fn(async () => okv({ ...newNpc(68), name: 'Guard', vendor: [stock(10)] })),
      searchEntities: vi.fn(async () => okv([{ id: 68, name: 'Guard' }])),
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    confirm.mockClear();
    render(<Live start={newNpc(12000001)} api={api} />);
    await chooseSource('Guard');
    expect(confirm).not.toHaveBeenCalled();
    expect(current.vendor.map((v) => v.item)).toEqual([10]);
  });

  it('does not copy from an NPC with no stock', async () => {
    const api = makeMockApi({
      readExistingEntity: vi.fn(async () => okv({ ...newNpc(68), name: 'Guard' })),
      searchEntities: vi.fn(async () => okv([{ id: 68, name: 'Guard' }])),
    });
    render(<Live start={withStock([stock(1)])} api={api} />);
    await chooseSource('Guard');
    expect(await screen.findByRole('alert')).toHaveTextContent('That NPC has no stock to copy.');
    expect(current.vendor.map((v) => v.item)).toEqual([1]);
  });

  it("does not copy an NPC's stock onto itself", async () => {
    const api = makeMockApi({ searchEntities: vi.fn(async () => okv([{ id: 12000001, name: 'Hela' }])) });
    render(<Live start={withStock([stock(1)])} api={api} />);
    await chooseSource('Hela');
    expect(await screen.findByRole('alert')).toHaveTextContent('That is this NPC.');
    expect(current.vendor.map((v) => v.item)).toEqual([1]);
  });

  it('leaves the stock of a project saved before vendors were read alone', () => {
    const old: CustomNpc = { ...newNpc(54), name: 'Innkeeper', origin: { kind: 'existing', original: { creature_template: [{ entry: '54' }] }, sharedLoot: 0, spawnCount: 1, locked: [] } };
    render(<NamesProvider api={makeMockApi()}><NpcEditor npc={old} onChange={vi.fn()} allocateSpawn={async () => null} existing={{ sharedLoot: 0, spawnCount: 1, locked: [] }} tab="vendor" /></NamesProvider>);
    expect(screen.getByText(/stock was not read/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Make this NPC a vendor' })).toBeNull();
  });
});
