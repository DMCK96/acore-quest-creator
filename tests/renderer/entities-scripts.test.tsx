// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NpcEditor } from '../../src/renderer/entities/npc/NpcEditor';
import { NamesProvider } from '../../src/renderer/state/names';
import { makeMockApi } from './mock-api';
import { newNpc, type CustomNpc, type GossipMenu } from '../../src/core/entities/model';
import { blankNpcScene, type NpcScene } from '../../src/core/scripts/npc-scenes';

afterEach(cleanup);

const blank = (id: string, name = ''): NpcScene => ({ ...blankNpcScene(id), name });
const menu = (menuId: number, over: Partial<GossipMenu> = {}): GossipMenu => ({
  menuId, textId: menuId + 1000, locked: false, greeting: [{ text: `Greeting ${menuId}`, textFemale: '', probability: 1 }],
  options: [{ optionId: 0, icon: 0, text: 'Bye', action: { kind: 'close' }, kept: false }], ...over,
});
const npcWith = (scenes: NpcScene[], base: Partial<CustomNpc> = {}): CustomNpc => ({ ...newNpc(12000001), name: 'Hela', scenes, ...base });
const existing = (extra: object = {}) =>
  ({ kind: 'existing' as const, original: {}, sharedLoot: 0, spawnCount: 1, locked: [], ...extra }) as CustomNpc['origin'];

let current: CustomNpc = newNpc(12000001);
function Live({ start, onTab, quests }: { start: CustomNpc; onTab?: (id: string) => void; quests?: { questId: number; title: string }[] }) {
  const [npc, setNpc] = useState(start);
  current = npc;
  return (
    <NamesProvider api={makeMockApi()}>
      <NpcEditor npc={npc} onChange={(n) => { current = n; setNpc(n); }} allocateSpawn={async () => 900} onTab={onTab} quests={quests} tab="scripts" />
    </NamesProvider>
  );
}

describe('the Scripts tab', () => {
  it('adds a scene with the next id and a talked-to trigger', async () => {
    render(<Live start={npcWith([])} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add scene' }));
    expect(current.scenes).toEqual([expect.objectContaining({ id: 's1', questId: 0, trigger: { kind: 'talkedTo' } })]);
  });

  it('duplicates a scene under a fresh id and removes one', async () => {
    render(<Live start={npcWith([blank('s1', 'Hello')])} />);
    await userEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    expect(current.scenes.map((s) => [s.id, s.name])).toEqual([['s1', 'Hello'], ['s2', 'Hello (copy)']]);
    await userEvent.click(screen.getAllByRole('button', { name: 'Remove scene' })[0]!);
    expect(current.scenes.map((s) => s.id)).toEqual(['s2']);
  });

  it('stops adding at 32 scenes', () => {
    render(<Live start={npcWith(Array.from({ length: 32 }, (_, i) => blank(`s${i + 1}`)))} />);
    expect(screen.getByRole('button', { name: 'Add scene' })).toBeDisabled();
  });

  it('offers no area trigger and says "needs a quest" until a quest is chosen', async () => {
    render(<Live start={npcWith([{ ...blank('s1'), trigger: { kind: 'questHandedIn' } }])} />);
    expect(within(screen.getByRole('combobox', { name: 'When' })).queryByRole('option', { name: /enters the area/ })).toBeNull();
    expect(screen.getByText('needs a quest')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Quest' }), 'Other…');
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Quest ID' }), '60001');
    expect(current.scenes[0]!.questId).toBe(60001);
    expect(screen.queryByText('needs a quest')).toBeNull();
  });

  it("offers the project's quests by title", async () => {
    render(<Live start={npcWith([blank('s1')])} quests={[{ questId: 60001, title: 'Wolves' }]} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Quest' }), 'Wolves');
    expect(current.scenes[0]!.questId).toBe(60001);
  });

  it("picks a gossipPicked option from the NPC's own tree only, and not a locked or kept one", async () => {
    const tree = { menus: [
      menu(5, { options: [
        { optionId: 0, icon: 0, text: 'Pickable', action: { kind: 'close' }, kept: false },
        { optionId: 1, icon: 0, text: 'Kept one', action: { kind: 'close' }, kept: true },
      ] }),
      menu(6, { locked: true }),
    ] };
    render(<Live start={npcWith([blank('s1')], { gossipMenu: tree })} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'When' }), 'A player picks an option of its talk window');
    const select = screen.getByRole('combobox', { name: 'Menu and option' });
    const options = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Choose an option…', 'Greeting 5 → Pickable']);
    await userEvent.selectOptions(select, 'Greeting 5 → Pickable');
    expect(current.scenes[0]!.trigger).toEqual({ kind: 'gossipPicked', menuId: 5, optionId: 0 });
  });

  it('offers a way to the Gossip tab when the NPC has no tree', async () => {
    const onTab = vi.fn();
    render(<Live start={npcWith([{ ...blank('s1'), trigger: { kind: 'gossipPicked', menuId: 0, optionId: 0 } }])} onTab={onTab} />);
    expect(screen.getByText(/no talk window yet/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Give this NPC a gossip menu' }));
    expect(onTab).toHaveBeenCalledWith('gossip');
  });

  it("shows a locked NPC's scenes read-only with the reason", () => {
    render(<Live start={npcWith([blank('s1', 'Hello')], { origin: existing({ locked: ['scenes'] }) })} />);
    expect(screen.getByText(/runs another AI or a script/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add scene' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Name (for you)' })).toBeDisabled();
  });

  it('says how many scripts the database already runs on an existing NPC', () => {
    render(<Live start={npcWith([], { origin: existing({ databaseScripts: 4 }) })} />);
    expect(screen.getByText(/already runs 4 scripts on this NPC/)).toBeInTheDocument();
    cleanup();
    render(<Live start={npcWith([], { origin: existing({ databaseScripts: 1 }) })} />);
    expect(screen.getByText(/already runs 1 script on this NPC/)).toBeInTheDocument();
  });
});

describe('the Scripts tab, after the fact', () => {
  it('shows an NPC adopted before the lock was recorded read-only, from the template it was read with', () => {
    const origin = existing({ original: { creature_template: [{ entry: '12000001', AIName: 'ReactorAI', ScriptName: '' }] } });
    render(<Live start={npcWith([blank('s1', 'Hello')], { origin })} />);
    expect(screen.getByText(/runs another AI or a script/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add scene' })).toBeDisabled();
  });

  it('shows a quest that is no longer in the project as an id to type', () => {
    render(<Live start={npcWith([{ ...blank('s1'), questId: 60001 }])} quests={[]} />);
    expect(screen.getByRole('combobox', { name: 'Quest' })).toHaveValue('other');
    expect(screen.getByRole('spinbutton', { name: 'Quest ID' })).toHaveValue(60001);
  });
});
