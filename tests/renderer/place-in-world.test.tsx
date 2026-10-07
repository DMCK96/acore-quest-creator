// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mountBody } from './module-harness';
import { ENTITIES_FIELD, newNpc, newSpawn, writeEntities, type Spawn } from '../../src/core/entities/model';
import { registry } from '@core/registry';
import { createNewAggregate } from '@core/import/new-quest';
import { loadSchema } from '@core/schema/load';
import { forkDb } from '../helpers/fixtures';
import { createAppStore } from '../../src/renderer/state/app-store';
import { ProjectEntitiesFromStore } from '../../src/renderer/state/project-entities';
import { NamesProvider } from '../../src/renderer/state/names';
import { RewardTablesProvider } from '../../src/renderer/state/reward-tables';
import { QuestEditorModal } from '../../src/renderer/views/QuestEditorModal';
import { SpawnList } from '../../src/renderer/entities/SpawnList';
import { PlaceInWorldProvider, type PlaceInWorld } from '../../src/renderer/world3d/ShowInWorldContext';
import { makeMockApi, okv, sampleOpen } from './mock-api';

const hela = { ...newNpc(12000005), name: 'Hela' };
const placed = { ...hela, spawns: [{ ...newSpawn(900), x: 1, y: 2 }] };
const giverOf = (npc: typeof hela) => ({ creature_queststarter: [{ id: npc.entry }], [ENTITIES_FIELD]: writeEntities({ npcs: [npc], objects: [], items: [] }) });
const card = () => screen.getByRole('region', { name: 'Starts at 1' });

describe('the giver card asks the World', () => {
  it('the giver body places an NPC in the world instead of opening a map', async () => {
    const placeInWorld = vi.fn();
    await mountBody('giver', giverOf(hela), { placeInWorld });
    expect(within(card()).queryByRole('button', { name: 'Place on map' })).toBeNull();
    await userEvent.click(within(card()).getByRole('button', { name: 'Place in world' }));
    expect(placeInWorld).toHaveBeenCalledWith({ kind: 'creature', entry: 12000005 });
  });

  it('with no game client the control is absent and nothing throws', async () => {
    await mountBody('giver', giverOf(hela), { showInWorld: undefined });
    expect(within(card()).getByText('Made with this quest.')).toBeTruthy();
    expect(within(card()).queryByRole('button', { name: 'Place in world' })).toBeNull();
    expect(within(card()).queryByRole('button', { name: 'Draw patrol' })).toBeNull();
  });

  it('Show in World still focuses the part', async () => {
    const showInWorld = vi.fn();
    await mountBody('giver', giverOf(placed), { showInWorld, placeInWorld: vi.fn() });
    // The card's own Show on map is gone: its Go to is the Show in World
    expect(within(card()).queryByRole('button', { name: 'Show on map' })).toBeNull();
    const go = within(card()).getByRole('button', { name: 'Go to Hela' });
    expect(go).toHaveAttribute('title', 'Show in World');
    await userEvent.click(go);
    expect(showInWorld).toHaveBeenCalledWith({ questId: 60001, kind: 'creature', entry: 12000005 });
  });
});

describe('the spawn list asks the World', () => {
  const spawn: Spawn = { ...newSpawn(900), x: 1, y: 2, z: 3, wander: 5 };
  const list = (place: PlaceInWorld | null, spawns: Spawn[], owner: { kind: 'npc' | 'obj'; entry: number } = { kind: 'npc', entry: 12000001 }) => (
    <NamesProvider api={makeMockApi()}>
      <PlaceInWorldProvider value={place}>
        <SpawnList idPrefix="e" ownerKey={owner} spawns={spawns} wanders={owner.kind === 'npc'} onChange={() => {}} allocate={async () => null} />
      </PlaceInWorldProvider>
    </NamesProvider>
  );

  it('offers Place in world for an NPC or object with no spawn', async () => {
    const place = vi.fn();
    const { rerender } = render(list(place, []));
    await userEvent.click(screen.getByRole('button', { name: 'Place in world' }));
    expect(place).toHaveBeenLastCalledWith({ kind: 'creature', entry: 12000001 });
    rerender(list(place, [], { kind: 'obj', entry: 9100001 }));
    await userEvent.click(screen.getByRole('button', { name: 'Place in world' }));
    expect(place).toHaveBeenLastCalledWith({ kind: 'object', entry: 9100001 });
  });

  it('shows the exact spawn in the World', async () => {
    const place = vi.fn();
    render(list(place, [spawn]));
    await userEvent.click(within(screen.getByText(/Spawn 1/).closest('li')!).getByRole('button', { name: 'Show in World' }));
    expect(place).toHaveBeenCalledWith({ kind: 'spawn', spawn: 'creature', entry: 12000001, guid: 900 });
  });

  it('offers a patrol for an NPC spawn and hides wander while it patrols', async () => {
    const place = vi.fn();
    const patrol = { pathId: 9000, startPace: 'walk' as const, points: [
      { x: 1, y: 1, z: 1, waitSecs: 0, facing: null, paceFromHere: null, actions: [] },
      { x: 2, y: 2, z: 2, waitSecs: 0, facing: null, paceFromHere: null, actions: [] }] };
    const { rerender } = render(list(place, [spawn]));
    expect(screen.getByLabelText('Wander (yards)')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Draw patrol' }));
    expect(place).toHaveBeenCalledWith({ kind: 'patrol', entry: 12000001, guid: 900 });
    rerender(list(place, [{ ...spawn, patrol }]));
    expect(screen.queryByLabelText('Wander (yards)')).toBeNull();
    expect(screen.getByText('Walks a patrol of 2 points.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit patrol' })).toBeTruthy();
  });

  it('offers no patrol for an object spawn, and nothing of the World without one', () => {
    const { rerender } = render(list(vi.fn(), [spawn], { kind: 'obj', entry: 9100001 }));
    expect(screen.queryByRole('button', { name: 'Draw patrol' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Show in World' })).toBeTruthy();
    rerender(list(null, [spawn]));
    expect(screen.queryByRole('button', { name: 'Show in World' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Draw patrol' })).toBeNull();
    rerender(list(null, []));
    expect(screen.queryByRole('button', { name: 'Place in world' })).toBeNull();
  });
});

describe('the quest editor steps aside for the World', () => {
  async function mountModal() {
    const schema = await loadSchema(forkDb(), registry.tables.map((t) => t.table));
    const a = createNewAggregate(schema, registry, 60123);
    const open = sampleOpen({ questId: 60123, aggregate: { ...a, values: { ...a.values, creature_queststarter: [{ id: 0 }] } } });
    const api = makeMockApi({ newQuest: vi.fn(async () => okv(open)), allocateIds: vi.fn(async (kind: string) => okv(kind === 'creature' ? [12000005] : [900])) });
    const store = createAppStore(api, { saveDelayMs: 0 });
    await store.getState().newQuest();
    const ends: (() => void)[] = [];
    const place = vi.fn((_request, onEnd?: () => void) => { if (onEnd) ends.push(onEnd); });
    render(<NamesProvider api={api}><RewardTablesProvider api={api}><ProjectEntitiesFromStore store={store}>
      <PlaceInWorldProvider value={place}><QuestEditorModal store={store} /></PlaceInWorldProvider>
    </ProjectEntitiesFromStore></RewardTablesProvider></NamesProvider>);
    return { store, place, end: () => act(() => ends.shift()!()) };
  }
  const openGiver = async () => {
    await userEvent.click(within(screen.getByRole('list', { name: 'Modules' })).getByRole('button', { name: /^Quest Giver/ }));
  };
  const newNpcOnPlacement = async () => {
    await openGiver();
    await userEvent.click(screen.getByRole('button', { name: 'New NPC for starts at 1' }));
    const editor = await screen.findByRole('dialog', { name: 'New NPC' });
    await userEvent.click(within(editor).getByRole('tab', { name: 'Placement' }));
    return editor;
  };

  it('while placing from the giver card, and comes back to the giver panel', async () => {
    const { store, place, end } = await mountModal();
    await newNpcOnPlacement();
    await userEvent.click(within(screen.getByRole('dialog', { name: 'New NPC' })).getByRole('button', { name: 'Done' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Quest Giver' })).getByRole('button', { name: 'Place in world' }));
    expect(place).toHaveBeenCalledWith({ kind: 'creature', entry: 12000005 }, expect.any(Function));
    expect(screen.queryByRole('dialog', { name: 'Edit quest' })).toBeNull();
    // The editor is only out of the way: the quest is still being edited
    expect(store.getState().screen).toBe('edit');
    end();
    expect(screen.getByRole('dialog', { name: 'Edit quest' })).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Quest Giver' })).toBeTruthy();
  });

  it('and the NPC editor comes back on the same tab', async () => {
    const { place, end } = await mountModal();
    const editor = await newNpcOnPlacement();
    await userEvent.click(within(editor).getByRole('button', { name: 'Place in world' }));
    expect(place).toHaveBeenCalledWith({ kind: 'creature', entry: 12000005 }, expect.any(Function));
    expect(screen.queryByRole('dialog', { name: 'New NPC' })).toBeNull();
    end();
    const back = screen.getByRole('dialog', { name: 'New NPC' });
    expect(within(back).getByRole('tab', { name: 'Placement' })).toHaveAttribute('aria-selected', 'true');
  });

  it('Escape in the World while it is aside closes nothing of it', async () => {
    const { end } = await mountModal();
    const editor = await newNpcOnPlacement();
    await userEvent.click(within(editor).getByRole('button', { name: 'Place in world' }));
    await userEvent.keyboard('{Escape}');
    await userEvent.keyboard('{Escape}');
    end();
    expect(screen.getByRole('dialog', { name: 'New NPC' })).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Quest Giver' })).toBeTruthy();
  });
});
