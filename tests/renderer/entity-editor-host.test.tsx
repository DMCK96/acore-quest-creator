// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LeafletMapProps } from '../../src/renderer/map/LeafletMap';
import { mountEditor } from './module-harness';
import { createAppStore } from '../../src/renderer/state/app-store';
import { QuestFlowView } from '../../src/renderer/views/QuestFlowView';
import { NamesProvider } from '../../src/renderer/state/names';
import { RewardTablesProvider } from '../../src/renderer/state/reward-tables';
import { registry } from '@core/registry';
import { createNewAggregate } from '@core/import/new-quest';
import { loadSchema } from '@core/schema/load';
import { ENTITIES_FIELD, newNpc, newSpawn, readEntities, writeEntities } from '../../src/core/entities/model';
import { forkDb } from '../helpers/fixtures';
import { makeMockApi, okv, sampleOpen } from './mock-api';

vi.mock('../../src/renderer/map/LeafletMap', () => ({ LeafletMap: (_p: LeafletMapProps) => <div aria-label="Leaflet stand-in" /> }));

const hela = { ...newNpc(12000005), name: 'Hela', displayId: 3167 };
const withHela = (npc = hela) => ({ [ENTITIES_FIELD]: writeEntities({ npcs: [npc], objects: [] }), creature_queststarter: [{ id: npc.entry }] });
const entitiesIn = (onChange: ReturnType<typeof vi.fn>) => readEntities({ [ENTITIES_FIELD]: onChange.mock.calls.filter(([f]) => f === ENTITIES_FIELD).at(-1)![1] });

describe('entity editor host', () => {
  it('titles a new NPC and says what it still needs', async () => {
    await mountEditor(withHela({ ...newNpc(12000005) }), { kind: 'npc', entry: 12000005, isNew: true });
    const dialog = screen.getByRole('dialog', { name: 'New NPC' });
    expect(within(dialog).getByText('Still needs a name and a look.')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Discard' })).toBeTruthy();
  });

  it('titles an existing NPC by name and offers Delete', async () => {
    await mountEditor(withHela(), { kind: 'npc', entry: 12000005, isNew: false });
    const dialog = screen.getByRole('dialog', { name: 'NPC: Hela' });
    expect(within(dialog).queryByText(/Still needs/)).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Delete NPC' })).toBeTruthy();
  });

  it('discard removes the NPC and its giver rows, after asking', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const { onChange, onClose } = await mountEditor(withHela(), { kind: 'npc', entry: 12000005, isNew: true });
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(confirm).toHaveBeenLastCalledWith('Discard this NPC? It is removed from the quest.');
    expect(entitiesIn(onChange).npcs).toEqual([]);
    expect(onChange).toHaveBeenCalledWith('creature_queststarter', []);
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when its entity goes away', async () => {
    const { onClose } = await mountEditor({ [ENTITIES_FIELD]: writeEntities({ npcs: [], objects: [] }) }, { kind: 'npc', entry: 12000005, isNew: false });
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

async function mountFlow() {
  const schema = await loadSchema(forkDb(), registry.tables.map((t) => t.table));
  const a = createNewAggregate(schema, registry, 60123);
  const open = sampleOpen({ questId: 60123, aggregate: { ...a, values: { ...a.values, creature_queststarter: [{ id: 0 }] } } });
  const api = makeMockApi({ newQuest: vi.fn(async () => okv(open)), allocateIds: vi.fn(async (kind: string) => okv(kind === 'creature' ? [12000005] : [900])) });
  const store = createAppStore(api, { saveDelayMs: 0 });
  await store.getState().newQuest();
  render(<NamesProvider api={api}><RewardTablesProvider api={api}><QuestFlowView store={store} /></RewardTablesProvider></NamesProvider>);
  return { store, api };
}

describe('the editor in the quest flow', () => {
  it('New NPC on the giver card creates it, puts it on the card and opens the editor over the giver panel', async () => {
    const { store } = await mountFlow();
    await userEvent.click(within(screen.getByRole('list', { name: 'Modules' })).getByRole('button', { name: /^Quest Giver/ }));
    await userEvent.click(screen.getByRole('button', { name: 'New NPC for starts at 1' }));
    const editor = await screen.findByRole('dialog', { name: 'New NPC' });
    const values = store.getState().open!.aggregate.values;
    expect(readEntities(values).npcs.map((n) => n.entry)).toEqual([12000005]);
    expect(readEntities(values).npcs[0]!.questGiver).toBe(true);
    expect(values.creature_queststarter).toEqual([{ id: 12000005 }]);
    await userEvent.click(within(editor).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog', { name: 'New NPC' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Quest Giver' })).toBeTruthy();
  });

  it('Escape closes the editor first, then the panel', async () => {
    await mountFlow();
    await userEvent.click(within(screen.getByRole('list', { name: 'Modules' })).getByRole('button', { name: /^Quest Giver/ }));
    await userEvent.click(screen.getByRole('button', { name: 'New NPC for starts at 1' }));
    await screen.findByRole('dialog', { name: 'New NPC' });
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'New NPC' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Quest Giver' })).toBeTruthy();
  });

  it('the editor hides for the map and comes back on the same tab', async () => {
    await mountFlow();
    await userEvent.click(within(screen.getByRole('list', { name: 'Modules' })).getByRole('button', { name: /^Quest Giver/ }));
    await userEvent.click(screen.getByRole('button', { name: 'New NPC for starts at 1' }));
    const editor = await screen.findByRole('dialog', { name: 'New NPC' });
    await userEvent.click(within(editor).getByRole('tab', { name: 'Placement' }));
    await userEvent.click(within(editor).getByRole('button', { name: 'Place on map' }));
    expect(screen.queryByRole('dialog', { name: 'New NPC' })).toBeNull();
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Quest map' })).getByRole('button', { name: 'Close' }));
    const back = await screen.findByRole('dialog', { name: 'New NPC' });
    expect(within(back).getByRole('tab', { name: 'Placement' })).toHaveAttribute('aria-selected', 'true');
  });

  it('Escape on the map goes back to the editor over the module it came from', async () => {
    await mountFlow();
    await userEvent.click(within(screen.getByRole('list', { name: 'Modules' })).getByRole('button', { name: /^Quest Giver/ }));
    await userEvent.click(screen.getByRole('button', { name: 'New NPC for starts at 1' }));
    const editor = await screen.findByRole('dialog', { name: 'New NPC' });
    await userEvent.click(within(editor).getByRole('tab', { name: 'Placement' }));
    await userEvent.click(within(editor).getByRole('button', { name: 'Place on map' }));
    await screen.findByRole('dialog', { name: 'Quest map' });
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Quest map' })).toBeNull();
    expect(await screen.findByRole('dialog', { name: 'New NPC' })).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Quest Giver' })).toBeTruthy();
  });
});
