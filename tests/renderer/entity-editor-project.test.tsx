// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EntityEditorHost } from '../../src/renderer/entities/EntityEditorHost';
import { NamesProvider } from '../../src/renderer/state/names';
import { EMPTY_ENTITIES, newNpc, newObject } from '../../src/core/entities/model';
import { emptyGiversOf } from '../../src/core/modules/givers';
import { makeMockApi } from './mock-api';

const hela = { ...newNpc(12000005), name: 'Hela', displayId: 3167 };
const crate = { ...newObject(9100001), name: 'Crate', displayId: 1 };
const none = { npcs: [], objects: [], items: [] };
const quests = [
  { questId: 60001, title: 'Kobold Camp', uses: { ...none, npcs: [12000005], objects: [9100001] } },
  { questId: 60002, title: 'Foreman\'s End', uses: { ...none, npcs: [12000005] } },
];
const host = (entities: any, state: any, handlers: { onChange?: any; onClose?: any; onDelete?: any } = {}) => (
  <NamesProvider api={makeMockApi()}>
    <EntityEditorHost entities={entities} onChange={handlers.onChange ?? vi.fn()} quests={quests} state={state} onTab={vi.fn()}
      onClose={handlers.onClose ?? vi.fn()} onDelete={handlers.onDelete} />
  </NamesProvider>
);

afterEach(() => vi.restoreAllMocks());

describe('the editor over the project store', () => {
  it('saves edits as the next store', async () => {
    const onChange = vi.fn();
    render(host({ ...EMPTY_ENTITIES, npcs: [hela] }, { kind: 'npc', entry: 12000005, isNew: false }, { onChange }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'x');
    expect(onChange.mock.calls.at(-1)![0].npcs[0].name).toBe('Helax');
  });

  it('delete names the quests that use it, then hands the delete on and closes', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onDelete = vi.fn();
    const onClose = vi.fn();
    render(host({ ...EMPTY_ENTITIES, npcs: [hela] }, { kind: 'npc', entry: 12000005, isNew: false }, { onDelete, onClose }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete NPC' }));
    expect(confirm).toHaveBeenCalledWith("Delete Hela? Quests 'Kobold Camp' and 'Foreman's End' name it; their giver cards will be emptied.");
    expect(onDelete).toHaveBeenCalledWith('npc', 12000005);
    expect(onClose).toHaveBeenCalled();
  });

  it('one quest using it is named alone; none, and it asks plainly', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const onDelete = vi.fn();
    render(host({ ...EMPTY_ENTITIES, objects: [crate] }, { kind: 'object', entry: 9100001, isNew: false }, { onDelete }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete object' }));
    expect(confirm).toHaveBeenLastCalledWith("Delete Crate? Quest 'Kobold Camp' names it; its giver cards will be emptied.");
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('a new one with no quest using it is discarded from the project', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const lone = { ...newObject(9100009), name: '' };
    render(host({ ...EMPTY_ENTITIES, objects: [lone] }, { kind: 'object', entry: 9100009, isNew: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(confirm).toHaveBeenCalledWith('Discard this object? It is removed from the project.');
  });

  it('closes itself when the entity goes (an undo)', () => {
    const onClose = vi.fn();
    const view = render(host({ ...EMPTY_ENTITIES, npcs: [hela] }, { kind: 'npc', entry: 12000005, isNew: false }, { onClose }));
    view.rerender(host(EMPTY_ENTITIES, { kind: 'npc', entry: 12000005, isNew: false }, { onClose }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows Lootable for the chest type and picks the quest an object is only usable during', async () => {
    const onChange = vi.fn();
    render(host({ ...EMPTY_ENTITIES, objects: [{ ...crate, type: 'chest' }] }, { kind: 'object', entry: 9100001, isNew: false, tab: 'basics' }, { onChange }));
    const type = screen.getByRole('combobox', { name: 'Type' }) as HTMLSelectElement;
    expect(type.selectedOptions[0]!.textContent).toBe('Lootable');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Only while on the quest' }), '60002');
    expect(onChange.mock.calls.at(-1)![0].objects[0].onlyDuringQuest).toBe(60002);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Only while on the quest' }), '');
    expect(onChange.mock.calls.at(-1)![0].objects[0].onlyDuringQuest).toBeNull();
  });
});

describe('emptyGiversOf', () => {
  it('empties every giver card that names an entity, keeping one empty card per role', () => {
    expect(emptyGiversOf({ creature_queststarter: [{ id: 12000005 }, { id: 1423 }] }, 'creature', 12000005)).toEqual({ creature_queststarter: [{ id: 0 }, { id: 1423 }] });
    expect(emptyGiversOf({ creature_queststarter: [{ id: 0 }, { id: 12000005 }] }, 'creature', 12000005)).toEqual({ creature_queststarter: [{ id: 0 }] });
    expect(emptyGiversOf({ creature_queststarter: [{ id: 12000005 }] }, 'creature', 12000005)).toEqual({ creature_queststarter: [{ id: 0 }] });
    expect(emptyGiversOf({}, 'creature', 12000005)).toEqual({});
  });
});
