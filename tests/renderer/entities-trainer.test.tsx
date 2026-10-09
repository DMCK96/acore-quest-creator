// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NpcEditor } from '../../src/renderer/entities/npc/NpcEditor';
import { NamesProvider } from '../../src/renderer/state/names';
import { makeMockApi, okv } from './mock-api';
import { newNpc, type CustomNpc } from '../../src/core/entities/model';

type T = NonNullable<CustomNpc['trainer']>;
const spell = (id: number, over: Partial<T['spells'][number]> = {}) => ({ spell: id, cost: 0, reqLevel: 0, reqSkill: 0, reqSkillRank: 0, reqSpells: [] as number[], ...over });
const trainer = (over: Partial<T> = {}): T => ({ trainerId: 900033, type: 'class', requirement: 1, greeting: 'Hi', spells: [spell(78)], ...over });
const npcWith = (t: T | null, base: Partial<CustomNpc> = {}): CustomNpc => ({ ...newNpc(12000001), name: 'Hela', trainer: t, ...base });
type Facts = { sharedLoot: number; spawnCount: number; sharedTrainer: number; locked: readonly ('type' | 'loot' | 'fight' | 'trainer')[] };

let current: CustomNpc = newNpc(12000001);
function Live({ start, api = makeMockApi(), allocate = async () => 900033, existing }: { start: CustomNpc; api?: ReturnType<typeof makeMockApi>; allocate?: () => Promise<number | null>; existing?: Facts }) {
  const [npc, setNpc] = useState(start);
  current = npc;
  return <NamesProvider api={api}><NpcEditor npc={npc} onChange={(n) => { current = n; setNpc(n); }} allocateSpawn={async () => 900} allocateTrainer={allocate} existing={existing} tab="trainer" /></NamesProvider>;
}
const steps = () => screen.getAllByRole('listitem');
const chooseSource = async (name: string) => {
  await userEvent.type(screen.getByRole('combobox', { name: 'Copy spells from…' }), name.toLowerCase());
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(name) }));
  await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
};

describe('the Trainer tab', () => {
  it('makes the NPC a trainer with an allocated id', async () => {
    render(<Live start={npcWith(null)} />);
    await userEvent.click(screen.getByRole('button', { name: 'Make this NPC a trainer' }));
    expect(current.trainer).toEqual({ trainerId: 900033, type: 'class', requirement: 0, greeting: '', spells: [] });
  });

  it('says so, and changes nothing, when no id could be got', async () => {
    render(<Live start={npcWith(null)} allocate={async () => null} />);
    await userEvent.click(screen.getByRole('button', { name: 'Make this NPC a trainer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not get a free trainer id.');
    expect(current.trainer).toBeNull();
  });

  it('edits the type, class and greeting; a class only for a class trainer', async () => {
    render(<Live start={npcWith(trainer())} />);
    await userEvent.selectOptions(screen.getByLabelText('Class'), 'Mage');
    expect(current.trainer!.requirement).toBe(8);
    await userEvent.clear(screen.getByLabelText('Greeting'));
    await userEvent.type(screen.getByLabelText('Greeting'), 'Welcome');
    expect(current.trainer!.greeting).toBe('Welcome');
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'Profession');
    expect(current.trainer).toMatchObject({ type: 'profession', requirement: 0 });
    expect(screen.queryByLabelText('Class')).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'Class');
    expect(current.trainer).toMatchObject({ type: 'class', requirement: 0 });
  });

  it('shows a class this editor has no name for', () => {
    render(<Live start={npcWith(trainer({ requirement: 12 }))} />);
    expect(within(screen.getByLabelText('Class')).getByRole('option', { name: 'Class 12' })).toBeTruthy();
  });

  it('adds, edits and removes spells', async () => {
    render(<Live start={npcWith(trainer())} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add spell' }));
    expect(current.trainer!.spells).toEqual([spell(78), spell(0)]);
    const second = steps()[1]!;
    fireEvent.change(within(second).getByLabelText('Gold'), { target: { value: '2' } });
    fireEvent.change(within(second).getByLabelText('Silver'), { target: { value: '30' } });
    fireEvent.change(within(second).getByLabelText('Copper'), { target: { value: '4' } });
    expect(current.trainer!.spells[1]!.cost).toBe(20000 + 3000 + 4);
    fireEvent.change(within(second).getByLabelText('Required level'), { target: { value: '300' } });
    expect(current.trainer!.spells[1]!.reqLevel).toBe(255);
    await userEvent.selectOptions(within(second).getByLabelText('Skill'), 'Alchemy');
    fireEvent.change(within(second).getByLabelText('Skill rank'), { target: { value: '75' } });
    expect(current.trainer!.spells[1]).toMatchObject({ reqSkill: 171, reqSkillRank: 75 });
    await userEvent.click(within(steps()[0]!).getByRole('button', { name: 'Remove' }));
    expect(current.trainer!.spells).toHaveLength(1);
    expect(current.trainer!.spells[0]!.reqSkill).toBe(171);
  });

  it('carries copper over into silver', () => {
    render(<Live start={npcWith(trainer({ spells: [spell(78)] }))} />);
    fireEvent.change(within(steps()[0]!).getByLabelText('Copper'), { target: { value: '150' } });
    expect(current.trainer!.spells[0]!.cost).toBe(150);
    expect(within(steps()[0]!).getByLabelText('Silver')).toHaveValue(1);
    expect(within(steps()[0]!).getByLabelText('Copper')).toHaveValue(50);
  });

  it('picks the spells it needs, offering the next only when the last is filled', async () => {
    const api = makeMockApi({ searchEntities: vi.fn(async (kind: string) => okv(kind === 'spell' ? [{ id: 133, name: 'Fireball' }] : [])) });
    render(<Live start={npcWith(trainer({ spells: [spell(0)] }))} api={api} />);
    expect(screen.queryByRole('combobox', { name: 'Needs spell 2' })).toBeNull();
    await userEvent.type(within(steps()[0]!).getByRole('combobox', { name: 'Needs spell 1' }), 'fire');
    await userEvent.click(await screen.findByRole('option', { name: /Fireball/ }));
    expect(current.trainer!.spells[0]!.reqSpells).toEqual([133]);
    expect(within(steps()[0]!).getByRole('combobox', { name: 'Needs spell 2' })).toBeTruthy();
  });

  it('removes the trainer after asking, when it has spells', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<Live start={npcWith(trainer())} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove trainer' }));
    expect(current.trainer).not.toBeNull();
    confirm.mockReturnValue(true);
    await userEvent.click(screen.getByRole('button', { name: 'Remove trainer' }));
    expect(current.trainer).toBeNull();
  });

  it("copies another NPC's spells, type, class and greeting, never its id, asking before replacing", async () => {
    const source = npcWith(trainer({ trainerId: 17, type: 'class', requirement: 3, greeting: 'Hunter!', spells: [spell(1), spell(2)] }), { entry: 68, name: 'Guard' });
    const api = makeMockApi({ readExistingEntity: vi.fn(async () => okv(source)), searchEntities: vi.fn(async () => okv([{ id: 68, name: 'Guard' }])) });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<Live start={npcWith(trainer())} api={api} />);
    await chooseSource('Guard');
    expect(confirm).toHaveBeenCalled();
    expect(current.trainer).toEqual({ trainerId: 900033, type: 'class', requirement: 3, greeting: 'Hunter!', spells: [spell(1), spell(2)] });
  });

  it('keeps its own spells when the author declines the replacement', async () => {
    const source = npcWith(trainer({ trainerId: 17, spells: [spell(1)] }), { entry: 68, name: 'Guard' });
    const api = makeMockApi({ readExistingEntity: vi.fn(async () => okv(source)), searchEntities: vi.fn(async () => okv([{ id: 68, name: 'Guard' }])) });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<Live start={npcWith(trainer())} api={api} />);
    await chooseSource('Guard');
    expect(current.trainer!.spells).toEqual([spell(78)]);
  });

  it('copies into an NPC that is not a trainer by allocating an id', async () => {
    const source = npcWith(trainer({ trainerId: 17, spells: [spell(1)] }), { entry: 68, name: 'Guard' });
    const api = makeMockApi({ readExistingEntity: vi.fn(async () => okv(source)), searchEntities: vi.fn(async () => okv([{ id: 68, name: 'Guard' }])) });
    const allocate = vi.fn(async () => 900050);
    render(<Live start={npcWith(null)} api={api} allocate={allocate} />);
    await chooseSource('Guard');
    expect(allocate).toHaveBeenCalled();
    expect(current.trainer).toMatchObject({ trainerId: 900050, spells: [spell(1)] });
  });

  it('does not copy from an NPC that is not a trainer', async () => {
    const api = makeMockApi({ readExistingEntity: vi.fn(async () => okv({ ...newNpc(68), name: 'Guard' })), searchEntities: vi.fn(async () => okv([{ id: 68, name: 'Guard' }])) });
    render(<Live start={npcWith(trainer())} api={api} />);
    await chooseSource('Guard');
    expect(await screen.findByRole('alert')).toHaveTextContent('That NPC is not a trainer.');
    expect(current.trainer!.spells).toEqual([spell(78)]);
  });

  it("does not copy an NPC's spells onto itself", async () => {
    const api = makeMockApi({ searchEntities: vi.fn(async () => okv([{ id: 12000001, name: 'Hela' }])) });
    render(<Live start={npcWith(trainer())} api={api} />);
    await chooseSource('Hela');
    expect(await screen.findByRole('alert')).toHaveTextContent('That is this NPC.');
    expect(current.trainer!.spells).toEqual([spell(78)]);
  });

  it('locks a trainer other NPCs share and gives the NPC its own copy', async () => {
    const origin = { kind: 'existing' as const, original: { creature_default_trainer: [{ CreatureId: '12000001', TrainerId: '17' }], trainer: [], trainer_spell: [] }, sharedLoot: 0, spawnCount: 1, sharedTrainer: 30, locked: ['trainer' as const] };
    render(<Live start={npcWith(trainer({ trainerId: 17 }), { origin })} existing={{ sharedLoot: 0, spawnCount: 1, sharedTrainer: 30, locked: ['trainer'] }} />);
    expect(screen.getByText(/30 other NPCs use this trainer/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add spell' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Give it its own copy' }));
    expect(current.trainer!.trainerId).toBe(900033);
    expect(current.trainer!.spells).toEqual([spell(78)]);
    expect((current.origin as { locked: string[] }).locked).toEqual([]);
    expect(await screen.findByRole('button', { name: 'Add spell' })).toBeTruthy();
  });

  it('says so, and changes nothing, when its own copy could not get an id', async () => {
    const origin = { kind: 'existing' as const, original: { creature_default_trainer: [{ CreatureId: '12000001', TrainerId: '17' }], trainer: [], trainer_spell: [] }, sharedLoot: 0, spawnCount: 1, sharedTrainer: 1, locked: ['trainer' as const] };
    render(<Live start={npcWith(trainer({ trainerId: 17 }), { origin })} allocate={async () => null} />);
    expect(screen.getByText(/1 other NPC uses this trainer/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Give it its own copy' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not get a free trainer id.');
    expect(current.trainer!.trainerId).toBe(17);
  });

  it('leaves a trainer it cannot model alone', () => {
    const origin = { kind: 'existing' as const, original: { creature_default_trainer: [{ CreatureId: '12000001', TrainerId: '17' }], trainer: [{ Id: '17', Type: '9' }], trainer_spell: [] }, sharedLoot: 0, spawnCount: 1, sharedTrainer: 0, locked: ['trainer' as const] };
    render(<Live start={npcWith(null, { origin })} />);
    expect(screen.getByText(/trainer is one this editor does not edit/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Make this NPC a trainer' })).toBeNull();
  });

  it('notes the older shared lists an NPC also uses', () => {
    const origin = { kind: 'existing' as const, original: { creature_default_trainer: [], trainer: [], trainer_spell: [], npc_trainer: [{ ID: '198', SpellID: '-200007' }, { ID: '198', SpellID: '-200008' }, { ID: '198', SpellID: '-200007' }] }, sharedLoot: 0, spawnCount: 1, sharedTrainer: 0, locked: [] };
    render(<Live start={npcWith(null, { origin })} />);
    expect(screen.getByText(/Also teaches the spells of 2 shared lists/)).toBeTruthy();
  });

  it('leaves the trainer of a project saved before trainers alone', () => {
    const old = npcWith(null, { origin: { kind: 'existing', original: { creature_template: [{ entry: '54' }] }, sharedLoot: 0, spawnCount: 1, sharedTrainer: 0, locked: [] } });
    render(<Live start={old} />);
    expect(screen.getByText(/trainer was not read/i)).toBeTruthy();
    expect(screen.getByText(/put back as the database has it/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Make this NPC a trainer' })).toBeNull();
  });
});
