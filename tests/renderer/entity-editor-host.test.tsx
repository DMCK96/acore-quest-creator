// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mountEditor } from './module-harness';
import { createAppStore } from '../../src/renderer/state/app-store';
import { ProjectEntitiesFromStore } from '../../src/renderer/state/project-entities';
import { QuestFlowView } from '../../src/renderer/views/QuestFlowView';
import { NamesProvider } from '../../src/renderer/state/names';
import { RewardTablesProvider } from '../../src/renderer/state/reward-tables';
import { registry } from '@core/registry';
import { createNewAggregate } from '@core/import/new-quest';
import { loadSchema } from '@core/schema/load';
import { ENTITIES_FIELD, newItem, newNpc, newSpawn, readEntities, writeEntities } from '../../src/core/entities/model';
import { forkDb } from '../helpers/fixtures';
import { makeMockApi, okv, sampleOpen } from './mock-api';

const hela = { ...newNpc(12000005), name: 'Hela', displayId: 3167 };
const withHela = (npc = hela) => ({ [ENTITIES_FIELD]: writeEntities({ npcs: [npc], objects: [], items: [] }), creature_queststarter: [{ id: npc.entry }] });
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

  it('discard hands the delete on (which empties the giver cards that named it), after asking', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const quests = [{ questId: 60001, title: 'Wolves', uses: { npcs: [12000005], objects: [], items: [] }, refs: { npcs: [12000005], objects: [], items: [] } }];
    const { onDelete, onClose } = await mountEditor(withHela({ ...newNpc(12000005) }), { kind: 'npc', entry: 12000005, isNew: true }, { quests });
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onDelete).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(confirm).toHaveBeenLastCalledWith("Discard this NPC? Quest 'Wolves' names it; its giver cards will be emptied.");
    expect(onDelete).toHaveBeenCalledWith('npc', 12000005);
    expect(onClose).toHaveBeenCalled();
  });

  it('opens a new item, titles it, and deletes it after asking', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { onDelete, onClose } = await mountEditor({ [ENTITIES_FIELD]: writeEntities({ npcs: [], objects: [], items: [newItem(990301)] }) }, { kind: 'item', entry: 990301, isNew: true });
    const dialog = screen.getByRole('dialog', { name: 'New item' });
    expect(within(dialog).getByRole('tab', { name: 'Basics' })).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));
    expect(onDelete).toHaveBeenCalledWith('item', 990301);
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when its entity goes away', async () => {
    const { onClose } = await mountEditor({ [ENTITIES_FIELD]: writeEntities({ npcs: [], objects: [], items: [] }) }, { kind: 'npc', entry: 12000005, isNew: false });
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
  render(<NamesProvider api={api}><RewardTablesProvider api={api}><ProjectEntitiesFromStore store={store}><QuestFlowView store={store} /></ProjectEntitiesFromStore></RewardTablesProvider></NamesProvider>);
  return { store, api };
}

describe('the editor in the quest flow', () => {
  it('New NPC on the giver card creates it, puts it on the card and opens the editor over the giver panel', async () => {
    const { store } = await mountFlow();
    await userEvent.click(within(screen.getByRole('list', { name: 'Modules' })).getByRole('button', { name: /^Quest Giver/ }));
    await userEvent.click(screen.getByRole('button', { name: 'New NPC for starts at 1' }));
    const editor = await screen.findByRole('dialog', { name: 'New NPC' });
    const values = store.getState().open!.aggregate.values;
    const { npcs } = store.getState().entities;
    expect(npcs.map((n) => n.entry)).toEqual([12000005]);
    expect(npcs[0]!.questGiver).toBe(true);
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

  it('keeps Tab inside the editor, not the panel under it', { timeout: 20000 }, async () => {
    await mountFlow();
    await userEvent.click(within(screen.getByRole('list', { name: 'Modules' })).getByRole('button', { name: /^Quest Giver/ }));
    await userEvent.click(screen.getByRole('button', { name: 'New NPC for starts at 1' }));
    const editor = await screen.findByRole('dialog', { name: 'New NPC' });
    // More presses than the editor has tab stops, so focus has to wrap round at least once.
    for (let i = 0; i < 25; i += 1) {
      await userEvent.tab();
      expect(editor.contains(document.activeElement)).toBe(true);
    }
    await userEvent.tab({ shift: true });
    expect(editor.contains(document.activeElement)).toBe(true);
  });

  it('puts focus on the panel below when what opened the editor is gone', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { store } = await mountFlow();
    await userEvent.click(within(screen.getByRole('list', { name: 'Modules' })).getByRole('button', { name: /^Quest Giver/ }));
    await userEvent.click(screen.getByRole('button', { name: 'New NPC for starts at 1' }));
    await screen.findByRole('dialog', { name: 'New NPC' });
    store.getState().setOpenPanel('entities');
    const list = await screen.findByRole('dialog', { name: 'NPCs, objects & items' });
    await userEvent.keyboard('{Escape}');
    await userEvent.click(within(list).getByRole('button', { name: 'Edit' }));
    const editor = await screen.findByRole('dialog', { name: /^NPC: / });
    await userEvent.click(within(editor).getByRole('button', { name: 'Delete NPC' }));
    expect(screen.queryByRole('dialog', { name: /^NPC: / })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'NPCs, objects & items' }).contains(document.activeElement)).toBe(true);
  });
});
