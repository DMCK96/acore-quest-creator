// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NpcEditor } from '../../src/renderer/entities/npc/NpcEditor';
import { NamesProvider } from '../../src/renderer/state/names';
import { makeMockApi, okv } from './mock-api';
import { newNpc, type CustomNpc, type GossipMenu, type GossipOption } from '../../src/core/entities/model';

afterEach(cleanup);

const option = (optionId: number, text = 'Bye', over: Partial<GossipOption> = {}): GossipOption => ({ optionId, icon: 0, text, action: { kind: 'close' }, kept: false, ...over });
const menu = (menuId: number, over: Partial<GossipMenu> = {}): GossipMenu => ({
  menuId, textId: menuId + 1000, locked: false, greeting: [{ text: `Greeting ${menuId}`, textFemale: '', probability: 1 }], options: [option(0)], ...over,
});
const npcWith = (menus: GossipMenu[] | null, base: Partial<CustomNpc> = {}): CustomNpc => ({ ...newNpc(12000001), name: 'Hela', gossip: true, gossipMenu: menus ? { menus } : null, ...base });
const existingOrigin = (extra: object = {}, original: Record<string, Record<string, string>[]> = { gossip_menu: [], gossip_menu_option: [], npc_text: [] }) =>
  ({ kind: 'existing' as const, original, sharedLoot: 0, spawnCount: 1, sharedTrainer: 0, locked: [], ...extra }) as CustomNpc['origin'];

let current: CustomNpc = newNpc(12000001);
function allocator() {
  const next = { gossipMenu: 2000000001, gossipText: 3000000001 };
  return vi.fn(async (kind: 'gossipMenu' | 'gossipText', count: number) => Array.from({ length: count }, () => next[kind]++));
}
function Live({ start, api = makeMockApi(), allocate = allocator(), onTab }: { start: CustomNpc; api?: ReturnType<typeof makeMockApi>; allocate?: ReturnType<typeof allocator> | (() => Promise<null>); onTab?: (id: string) => void }) {
  const [npc, setNpc] = useState(start);
  current = npc;
  return (
    <NamesProvider api={api}>
      <NpcEditor npc={npc} onChange={(n) => { current = n; setNpc(n); }} allocateSpawn={async () => 900} allocateGossip={allocate as never} onTab={onTab} tab="gossip" />
    </NamesProvider>
  );
}
const options = () => within(screen.getByRole('list', { name: 'Options' })).getAllByRole('listitem');
const variants = () => within(screen.getByRole('list', { name: 'Greeting' })).getAllByRole('listitem');
const tree = () => current.gossipMenu!.menus;
const chooseSource = async (name: string) => {
  await userEvent.type(screen.getByRole('combobox', { name: 'Copy menu from…' }), name.toLowerCase());
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(name) }));
  await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
};

describe('the Gossip tab: making and editing a menu', () => {
  it('gives the NPC a menu with a blank greeting and turns Can be talked to on', async () => {
    render(<Live start={npcWith(null, { gossip: false })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Give this NPC a gossip menu' }));
    expect(current.gossip).toBe(true);
    expect(current.gossipMenu).toEqual({ menus: [{ menuId: 2000000001, textId: 3000000001, locked: false, greeting: [{ text: '', textFemale: '', probability: 1 }], options: [] }] });
  });

  it('says so, and changes nothing, when no ids could be got', async () => {
    render(<Live start={npcWith(null)} allocate={async () => null} />);
    await userEvent.click(screen.getByRole('button', { name: 'Give this NPC a gossip menu' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not get free gossip ids.');
    expect(current.gossipMenu).toBeNull();
  });

  it('edits the greeting: text, female text and chance, with variants added and removed', async () => {
    render(<Live start={npcWith([menu(5)])} />);
    fireEvent.change(within(variants()[0]!).getByLabelText('Text'), { target: { value: 'Welcome' } });
    fireEvent.change(within(variants()[0]!).getByLabelText('Female text'), { target: { value: 'Welcome, lady' } });
    fireEvent.change(within(variants()[0]!).getByLabelText('Chance'), { target: { value: '0.5' } });
    expect(tree()[0]!.greeting[0]).toEqual({ text: 'Welcome', textFemale: 'Welcome, lady', probability: 0.5 });
    expect(screen.queryByRole('button', { name: 'Remove variant' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Add variant' }));
    expect(tree()[0]!.greeting).toHaveLength(2);
    await userEvent.click(within(variants()[0]!).getByRole('button', { name: 'Remove variant' }));
    expect(tree()[0]!.greeting).toHaveLength(1);
  });

  it('allows at most eight variants', async () => {
    render(<Live start={npcWith([menu(5, { greeting: Array.from({ length: 8 }, (_, i) => ({ text: `v${i}`, textFemale: '', probability: 1 })) })])} />);
    expect(screen.queryByRole('button', { name: 'Add variant' })).toBeNull();
  });

  it('adds options with the next id, edits their text and icon, and removes them', async () => {
    render(<Live start={npcWith([menu(5, { options: [option(0), option(3, 'Later')] })])} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add option' }));
    expect(tree()[0]!.options.map((o) => o.optionId)).toEqual([0, 3, 4]);
    expect(tree()[0]!.options[2]).toEqual({ optionId: 4, icon: 0, text: '', action: { kind: 'close' }, kept: false });
    fireEvent.change(within(options()[2]!).getByLabelText('Text'), { target: { value: 'Farewell' } });
    fireEvent.change(within(options()[2]!).getByLabelText('Icon'), { target: { value: '3' } });
    expect(tree()[0]!.options[2]).toMatchObject({ text: 'Farewell', icon: 3 });
    await userEvent.click(within(options()[0]!).getByRole('button', { name: 'Remove' }));
    expect(tree()[0]!.options.map((o) => o.optionId)).toEqual([3, 4]);
    // A removed id is not given out again by the next option
    await userEvent.click(screen.getByRole('button', { name: 'Add option' }));
    expect(tree()[0]!.options.map((o) => o.optionId)).toEqual([3, 4, 5]);
  });

  it('has no way to reorder options: the game shows them by id, so an order would not last', () => {
    render(<Live start={npcWith([menu(5, { options: [option(0, 'A'), option(1, 'B')] })])} />);
    expect(screen.queryByRole('button', { name: 'Up' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Down' })).toBeNull();
  });

  it('never gives a new option an id the database held for the menu, though it was removed', async () => {
    const original = { gossip_menu: [], npc_text: [], gossip_menu_option: [{ MenuID: '5', OptionID: '0' }, { MenuID: '5', OptionID: '7' }, { MenuID: '6', OptionID: '9' }] };
    render(<Live start={npcWith([menu(5, { options: [option(0, 'A')] })], { origin: existingOrigin({}, original) })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add option' }));
    expect(tree()[0]!.options.map((o) => o.optionId)).toEqual([0, 8]);
  });

  it('shows the menu an option opens even when it opens its own menu', async () => {
    render(<Live start={npcWith([menu(5, { options: [option(0, 'Again', { action: { kind: 'menu', menuId: 5 } })] }), menu(6)])} />);
    expect(within(options()[0]!).getByLabelText('Menu')).toHaveValue('5');
  });

  it('chooses what an option does: a service sets its icon only while the icon is 0, closing and opening a menu', async () => {
    render(<Live start={npcWith([menu(5, { options: [option(0), option(1, 'Other', { icon: 4 })] })], { vendor: [{ item: 1, maxCount: 0, restockSecs: 0, extendedCost: 0 }] })} />);
    await userEvent.selectOptions(within(options()[0]!).getByLabelText('Does'), 'Vendor');
    expect(tree()[0]!.options[0]).toMatchObject({ icon: 1, action: { kind: 'service', type: 3, npcFlag: 128 } });
    await userEvent.selectOptions(within(options()[1]!).getByLabelText('Does'), 'Vendor');
    expect(tree()[0]!.options[1]).toMatchObject({ icon: 4, action: { kind: 'service', type: 3, npcFlag: 128 } });
    await userEvent.selectOptions(within(options()[0]!).getByLabelText('Does'), 'Closes the window');
    expect(tree()[0]!.options[0]!.action).toEqual({ kind: 'close' });
  });

  it('opens a new menu from an option when the NPC has no other, with new ids, and a menu id the database has', async () => {
    render(<Live start={npcWith([menu(5)])} />);
    await userEvent.selectOptions(within(options()[0]!).getByLabelText('Does'), 'Opens menu…');
    expect(tree()).toHaveLength(2);
    expect(tree()[1]).toMatchObject({ menuId: 2000000001, textId: 3000000001, locked: false, options: [] });
    expect(tree()[0]!.options[0]!.action).toEqual({ kind: 'menu', menuId: 2000000001 });
    fireEvent.change(within(options()[0]!).getByLabelText('Menu id'), { target: { value: '777' } });
    expect(tree()[0]!.options[0]!.action).toEqual({ kind: 'menu', menuId: 777 });
  });

  it('opens one of the NPC\'s other menus, or a new one', async () => {
    render(<Live start={npcWith([menu(5, { options: [option(0), option(1, 'Other')] }), menu(6)])} />);
    await userEvent.selectOptions(within(options()[0]!).getByLabelText('Does'), 'Opens menu…');
    expect(tree()[0]!.options[0]!.action).toEqual({ kind: 'menu', menuId: 6 });
    expect(tree()).toHaveLength(2);
    await userEvent.selectOptions(within(options()[0]!).getByLabelText('Menu'), 'New menu…');
    expect(tree()).toHaveLength(3);
    expect(tree()[0]!.options[0]!.action).toEqual({ kind: 'menu', menuId: 2000000001 });
  });

  it('does not make a new menu when no ids could be got', async () => {
    render(<Live start={npcWith([menu(5)])} allocate={async () => null} />);
    await userEvent.selectOptions(within(options()[0]!).getByLabelText('Does'), 'Opens menu…');
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not get free gossip ids.');
    expect(tree()).toHaveLength(1);
    expect(tree()[0]!.options[0]!.action).toEqual({ kind: 'close' });
  });

  it('switches between the NPC\'s menus, and removes a menu other than the first', async () => {
    render(<Live start={npcWith([menu(5, { options: [option(0, 'More', { action: { kind: 'menu', menuId: 6 } })] }), menu(6)])} />);
    expect(screen.getByRole('button', { name: 'Greeting 5' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Greeting 6' }));
    expect(within(variants()[0]!).getByLabelText('Text')).toHaveValue('Greeting 6');
    await userEvent.click(screen.getByRole('button', { name: 'Remove menu' }));
    expect(tree().map((m) => m.menuId)).toEqual([5]);
    expect(screen.queryByRole('button', { name: 'Remove menu' })).toBeNull();
  });

  it('keeps an option the database ties to a condition or a script: its text can change, nothing else', async () => {
    render(<Live start={npcWith([menu(5, { options: [option(0, 'Scripted', { kept: true })] })])} />);
    expect(within(options()[0]!).queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(within(options()[0]!).getByLabelText('Does')).toBeDisabled();
    expect(within(options()[0]!).getByText(/Kept as it is/)).toBeTruthy();
    fireEvent.change(within(options()[0]!).getByLabelText('Text'), { target: { value: 'Renamed' } });
    expect(tree()[0]!.options[0]).toMatchObject({ text: 'Renamed', kept: true });
    expect(screen.queryByRole('button', { name: 'Remove menu' })).toBeNull();
  });

  it('says a service the NPC cannot do would never show, with a way to set it up', async () => {
    const onTab = vi.fn();
    const vendorOption = option(0, 'Browse', { action: { kind: 'service', type: 3, npcFlag: 128 } });
    render(<Live start={npcWith([menu(5, { options: [vendorOption, option(1, 'Train', { action: { kind: 'service', type: 5, npcFlag: 16 } }), option(2, 'Bank', { action: { kind: 'service', type: 9, npcFlag: 131072 } })] })], { origin: existingOrigin() })} onTab={onTab} />);
    expect(within(options()[0]!).getByText('This NPC is not a vendor, so this option would never show.')).toBeTruthy();
    await userEvent.click(within(options()[0]!).getByRole('button', { name: 'Make it a vendor' }));
    expect(onTab).toHaveBeenCalledWith('vendor');
    await userEvent.click(within(options()[1]!).getByRole('button', { name: 'Make it a trainer' }));
    expect(onTab).toHaveBeenCalledWith('trainer');
    expect(within(options()[2]!).getByText(/not set up for banker/i)).toBeTruthy();
  });

  it('is quiet about a window a new NPC is given the flag for when it is exported', () => {
    render(<Live start={npcWith([menu(5, { options: [option(0, 'Bank', { action: { kind: 'service', type: 9, npcFlag: 131072 } })] })])} />);
    expect(screen.queryByText(/not set up for banker/i)).toBeNull();
  });

  it('is quiet about a service the NPC can do', () => {
    render(<Live start={npcWith([menu(5, { options: [option(0, 'Browse', { action: { kind: 'service', type: 3, npcFlag: 128 } })] })], { vendor: [{ item: 1, maxCount: 0, restockSecs: 0, extendedCost: 0 }] })} />);
    expect(within(options()[0]!).queryByText(/would never show/)).toBeNull();
  });

  it('names a service it has no name for', () => {
    render(<Live start={npcWith([menu(5, { options: [option(0, 'Odd', { action: { kind: 'service', type: 20, npcFlag: 1 } })] })])} />);
    expect(within(within(options()[0]!).getByLabelText('Does')).getByRole('option', { name: 'Other (type 20, flag 1)' })).toBeTruthy();
  });

  it('tells the author players cannot open the menu while Can be talked to is off, and turns it on', async () => {
    render(<Live start={npcWith([menu(5)], { gossip: false })} />);
    expect(screen.getByText(/Players cannot open this menu until Can be talked to is on/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Turn it on' }));
    expect(current.gossip).toBe(true);
  });
});

describe('the Gossip tab: menus other NPCs use', () => {
  const lockedTree = () => [
    menu(5, { locked: true, options: [option(0, 'More', { action: { kind: 'menu', menuId: 6 } })] }),
    menu(6, { locked: true, options: [option(0, 'Hidden', { kept: true })] }),
    menu(7),
  ];
  const origin = () => existingOrigin({ sharedMenus: { 5: 30 }, sharedTexts: {} });

  it('shows it read-only, with who else uses it', () => {
    render(<Live start={npcWith(lockedTree(), { origin: origin() })} />);
    expect(screen.getByText(/30 other NPCs or objects use this menu/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add option' })).toBeNull();
    expect(screen.getByText('Says: Greeting 5')).toBeTruthy();
  });

  it('gives the NPC its own copy of the menu and the locked menus only it opens, repointing, after asking about kept options', async () => {
    const allocate = allocator();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<Live start={npcWith(lockedTree(), { origin: origin() })} allocate={allocate} />);
    await userEvent.click(screen.getByRole('button', { name: 'Give it its own copy' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('conditions and scripts stay with the original'));
    expect(tree().map((m) => [m.menuId, m.textId, m.locked])).toEqual([[2000000001, 3000000001, false], [2000000002, 3000000002, false], [7, 1007, false]]);
    expect(tree()[0]!.options[0]!.action).toEqual({ kind: 'menu', menuId: 2000000002 });
    expect(tree()[1]!.options[0]!.kept).toBe(false);
    expect(await screen.findByRole('button', { name: 'Add option' })).toBeTruthy();
  });

  it('keeps everything when the author declines the copy, or when no ids could be got', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<Live start={npcWith(lockedTree(), { origin: origin() })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Give it its own copy' }));
    expect(tree().map((m) => m.menuId)).toEqual([5, 6, 7]);
    cleanup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<Live start={npcWith(lockedTree(), { origin: origin() })} allocate={async () => null} />);
    await userEvent.click(screen.getByRole('button', { name: 'Give it its own copy' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not get free gossip ids.');
    expect(tree().map((m) => m.menuId)).toEqual([5, 6, 7]);
  });

  it('copies the whole tree\'s locked menus at once', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<Live start={npcWith([menu(5, { locked: true }), menu(8, { locked: true })], { origin: origin() })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy the whole menu tree' }));
    expect(tree().every((m) => m.menuId > 2000000000 && !m.locked)).toBe(true);
  });

  it('lets the NPC stop having a shared menu without touching it', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<Live start={npcWith(lockedTree(), { origin: origin() })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove gossip menu' }));
    expect(current.gossipMenu).toBeNull();
  });
});

describe('the Gossip tab: removing and copying', () => {
  it('removes the whole menu after asking, when it has options', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<Live start={npcWith([menu(5)])} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove gossip menu' }));
    expect(current.gossipMenu).not.toBeNull();
    confirm.mockReturnValue(true);
    await userEvent.click(screen.getByRole('button', { name: 'Remove gossip menu' }));
    expect(current.gossipMenu).toBeNull();
  });

  const source = (menus: GossipMenu[] | null) => npcWith(menus, { entry: 68, name: 'Guard' });
  const apiFor = (found: CustomNpc) => makeMockApi({ readExistingEntity: vi.fn(async () => okv(found)), searchEntities: vi.fn(async () => okv([{ id: 68, name: 'Guard' }, { id: 12000001, name: 'Hela' }])) });

  it('copies another NPC\'s whole tree under new ids, nothing locked or kept, asking before it replaces one', async () => {
    const found = source([menu(5, { locked: true, options: [option(0, 'More', { action: { kind: 'menu', menuId: 6 }, kept: true })] }), menu(6, { locked: true })]);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<Live start={npcWith([menu(9)])} api={apiFor(found)} />);
    await chooseSource('Guard');
    expect(confirm).toHaveBeenCalled();
    expect(tree().map((m) => [m.menuId, m.textId, m.locked])).toEqual([[2000000001, 3000000001, false], [2000000002, 3000000002, false]]);
    expect(tree()[0]!.options[0]).toMatchObject({ action: { kind: 'menu', menuId: 2000000002 }, kept: false });
    expect(current.gossip).toBe(true);
  });

  it('copies into an NPC with no menu without asking, and turns Can be talked to on', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<Live start={npcWith(null, { gossip: false })} api={apiFor(source([menu(5)]))} />);
    await chooseSource('Guard');
    expect(confirm).not.toHaveBeenCalled();
    expect(tree()).toHaveLength(1);
    expect(current.gossip).toBe(true);
  });

  it('keeps its own menu when the author declines', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<Live start={npcWith([menu(9)])} api={apiFor(source([menu(5)]))} />);
    await chooseSource('Guard');
    expect(tree().map((m) => m.menuId)).toEqual([9]);
  });

  it('does not copy from an NPC with no menu or from itself, or when ids cannot be got', async () => {
    render(<Live start={npcWith([menu(9)])} api={apiFor(source(null))} />);
    await chooseSource('Guard');
    expect(await screen.findByRole('alert')).toHaveTextContent('That NPC has no gossip menu.');
    cleanup();
    render(<Live start={npcWith([menu(9)])} api={apiFor(source([menu(5)]))} />);
    await chooseSource('Hela');
    expect(await screen.findByRole('alert')).toHaveTextContent('That is this NPC.');
    cleanup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<Live start={npcWith([menu(9)])} api={apiFor(source([menu(5)]))} allocate={async () => null} />);
    await chooseSource('Guard');
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not get free gossip ids.');
    expect(tree().map((m) => m.menuId)).toEqual([9]);
  });

  it('reads the database\'s tree when the project\'s copy of the source never read its gossip', async () => {
    const found = source([menu(5)]);
    const api = apiFor(found);
    render(<Live start={npcWith(null)} api={api} />);
    await chooseSource('Guard');
    expect(api.readExistingEntity).toHaveBeenCalledWith('npc', 68);
  });

  it('leaves the gossip of a project saved before gossip alone', () => {
    const old = npcWith(null, { origin: existingOrigin({}, { creature_template: [{ entry: '54' }] }) });
    render(<Live start={old} />);
    expect(screen.getByText(/gossip was not read/i)).toBeTruthy();
    expect(screen.getByText(/put back as the database has it/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Give this NPC a gossip menu' })).toBeNull();
  });
});
