// tests/renderer/entity-editor-existing.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EntityEditorHost } from '../../src/renderer/entities/EntityEditorHost';
import { NamesProvider } from '../../src/renderer/state/names';
import { EMPTY_ENTITIES, newNpc, newObject } from '../../src/core/entities/model';
import { makeMockApi } from './mock-api';

const origin = (over: Partial<{ sharedLoot: number; spawnCount: number; locked: ('type' | 'loot' | 'fight')[] }> = {}) =>
  ({ kind: 'existing' as const, original: {}, sharedLoot: 0, spawnCount: 1, locked: [], ...over });
const guard = (o = origin()) => ({ ...newNpc(1423), name: 'Stormwind Guard', displayId: 3167, origin: o });
const host = (entities: any, kind: 'npc' | 'object', entry: number, onChange = vi.fn(), onClose = vi.fn(), tab?: string) =>
  render(
    <NamesProvider api={makeMockApi()}>
      <EntityEditorHost entities={entities} onChange={onChange} quests={[]} state={{ kind, entry, isNew: false, tab }} onTab={vi.fn()} onClose={onClose} onDelete={vi.fn()} />
    </NamesProvider>,
  );

afterEach(() => vi.restoreAllMocks());

describe('editing an existing entity', () => {
  it('is titled as existing and offers Put back instead of Delete', () => {
    host({ ...EMPTY_ENTITIES, npcs: [guard()] }, 'npc', 1423);
    const dialog = screen.getByRole('dialog', { name: 'NPC: Stormwind Guard (existing)' });
    expect(within(dialog).getByRole('button', { name: 'Put back as the database has it' })).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Delete NPC' })).toBeNull();
  });

  it('Put back drops it from the store after asking, and closes', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onChange = vi.fn();
    const onClose = vi.fn();
    host({ ...EMPTY_ENTITIES, npcs: [guard()] }, 'npc', 1423, onChange, onClose);
    await userEvent.click(screen.getByRole('button', { name: 'Put back as the database has it' }));
    expect(window.confirm).toHaveBeenCalledWith('Put back Stormwind Guard as the database has it? The changes made to it here are dropped.');
    expect(onChange).toHaveBeenCalledWith(EMPTY_ENTITIES);
    expect(onClose).toHaveBeenCalled();
  });

  it('warns when it has several spawns, naming how many', () => {
    host({ ...EMPTY_ENTITIES, npcs: [guard(origin({ spawnCount: 12 }))] }, 'npc', 1423);
    expect(screen.getByText('Stormwind Guard has 12 spawns in the world: changes here change all of them.')).toBeTruthy();
  });

  it('warns on the Loot tab when other templates share its loot list', () => {
    host({ ...EMPTY_ENTITIES, npcs: [guard(origin({ sharedLoot: 3 }))] }, 'npc', 1423, vi.fn(), vi.fn(), 'loot');
    expect(screen.getByText('3 others share this loot list: changing it changes theirs too.')).toBeTruthy();
  });

  it('shows a locked fight and loot as read-only, and no Placement tab', async () => {
    host({ ...EMPTY_ENTITIES, npcs: [guard(origin({ locked: ['loot', 'fight'] }))] }, 'npc', 1423, vi.fn(), vi.fn(), 'fight');
    expect(screen.getByText('Stormwind Guard already has scripts in the database, so its fight is not edited here.')).toBeTruthy();
    await userEvent.click(screen.getByRole('tab', { name: 'Loot' }));
    expect(screen.getByText('Its loot list uses references or groups, which are not edited here.')).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Placement' })).toBeNull();
  });

  it('an object of a type the editor does not have keeps its type, saying so', () => {
    host({ ...EMPTY_ENTITIES, objects: [{ ...newObject(143981), name: 'Mailbox', displayId: 1949, origin: origin({ locked: ['type'] }) }] }, 'object', 143981);
    expect(screen.getByText('Its type is one this editor does not change.')).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Type' })).toBeNull();
  });
});
