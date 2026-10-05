// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectChanges } from '../../src/renderer/world3d/ProjectChanges';
import { ProjectEntitiesProvider } from '../../src/renderer/state/project-entities';
import { EMPTY_ENTITIES, newNpc, newObject, newSpawn } from '../../src/core/entities/model';
import { makeMockApi, okv } from './mock-api';

const entities = {
  ...EMPTY_ENTITIES,
  npcs: [{ ...newNpc(12000001), name: 'Hela', spawns: [{ ...newSpawn(6000001), map: 0, x: 1, y: 2, z: 3 }] }],
  objects: [{ ...newObject(9100001), name: 'Crate' }],
};
const uses = { npcs: [12000001], objects: [], items: [] };
const quests = [{ questId: 60001, title: 'Wolves', uses, refs: uses }];
const tracked = [
  { kind: 'npc', entry: 12000001, name: 'Hela', origin: 'new', changes: ['new'], usedBy: [60001], goTo: { kind: 'creature', guid: 6000001, map: 0, x: 1, y: 2, z: 3 } },
  { kind: 'object', entry: 9100001, name: 'Crate', origin: 'new', changes: ['new'], usedBy: [], goTo: null },
] as any[];
const mount = (extra: any[] = [], api = makeMockApi({
  worldChanges: vi.fn(async () => okv([])),
  exportProject: vi.fn(async () => okv({ applyPath: 'C:\\out\\a_project.sql', revertPath: 'C:\\out\\a_project_revert.sql', sql: '', warnings: [] })),
})) => {
  const onEdit = vi.fn();
  const onGoTo = vi.fn();
  render(
    <ProjectEntitiesProvider value={{ entities, setEntities: vi.fn(), quests, tracked: [...tracked, ...extra], create: vi.fn(), remove: vi.fn() } as any}>
      <ProjectChanges api={api} onLayer={vi.fn()} onClose={vi.fn()} onEdit={onEdit} onGoTo={onGoTo} />
    </ProjectEntitiesProvider>,
  );
  return { api, onEdit, onGoTo };
};

describe('Project changes', () => {
  it("is titled Project changes and lists the project's NPCs and objects first", async () => {
    mount();
    const dialog = screen.getByRole('dialog', { name: 'Project changes' });
    const section = within(dialog).getByRole('region', { name: 'NPCs, objects & items' });
    const hela = within(section).getByRole('listitem', { name: 'Hela' });
    expect(within(hela).getByText('NPC 12000001 · New · used by Wolves')).toBeTruthy();
    const crate = within(section).getByRole('listitem', { name: 'Crate' });
    expect(within(crate).getByText('Object 9100001 · New')).toBeTruthy();
    expect(await within(dialog).findByText('No world changes.')).toBeTruthy();
  });

  it('edits and goes to an entry', async () => {
    const { onEdit, onGoTo } = mount();
    const hela = screen.getByRole('listitem', { name: 'Hela' });
    await userEvent.click(within(hela).getByRole('button', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalledWith('npc', 12000001);
    await userEvent.click(within(hela).getByRole('button', { name: 'Go to' }));
    expect(onGoTo).toHaveBeenCalledWith({ kind: 'creature', guid: 6000001, map: 0, x: 1, y: 2, z: 3 });
    expect(within(screen.getByRole('listitem', { name: 'Crate' })).getByRole('button', { name: 'Go to' })).toHaveProperty('disabled', true);
  });

  it('lists existing NPCs the project changed beside its new ones, and edits them too', async () => {
    const { onEdit } = mount([{ kind: 'npc', entry: 1423, name: 'Stormwind Guard', origin: 'existing', changes: ['spawns'], usedBy: [], goTo: null }]);
    const row = screen.getByRole('listitem', { name: 'Stormwind Guard' });
    expect(within(row).getByText('NPC 1423 · Spawns changed')).toBeTruthy();
    await userEvent.click(within(row).getByRole('button', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalledWith('npc', 1423);
  });

  it('says which existing ones the database changed since', async () => {
    const api = makeMockApi({ worldChanges: vi.fn(async () => okv([])), existingDrift: vi.fn(async () => okv([{ kind: 'npc' as const, entry: 1423 }])) });
    mount([{ kind: 'npc', entry: 1423, name: 'Stormwind Guard', origin: 'existing', changes: ['details'], usedBy: [], goTo: null }], api);
    expect(await within(screen.getByRole('listitem', { name: 'Stormwind Guard' })).findByText('Changed in the database since')).toBeTruthy();
    expect(api.existingDrift).toHaveBeenCalledTimes(1);
  });

  it('exports the project patch with only new NPCs and no world changes', async () => {
    const { api } = mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Export project patch' }));
    expect(api.exportProject).toHaveBeenCalled();
    expect(await screen.findByText(/a_project\.sql/)).toBeTruthy();
  });

  it("shows the export's warnings beside where it wrote the patch", async () => {
    const warning = '"Stormwind Guard" changed in the database since it was edited here; applying the patch overwrites that.';
    mount([], makeMockApi({
      worldChanges: vi.fn(async () => okv([])),
      exportProject: vi.fn(async () => okv({ applyPath: 'C:\out\a_project.sql', revertPath: 'C:\out\a_project_revert.sql', sql: '', warnings: [warning] })),
    }));
    await userEvent.click(await screen.findByRole('button', { name: 'Export project patch' }));
    expect(await screen.findByText(warning)).toBeTruthy();
  });

  it('lists what to fix when the export is refused', async () => {
    const issues = [{ severity: 'error', code: 'NPC_NO_LOOK', message: 'Hela has no look.' }, { severity: 'warning', code: 'W', message: 'Just a warning.' }];
    mount([], makeMockApi({ worldChanges: vi.fn(async () => okv([])),
      exportProject: vi.fn(async () => ({ ok: false, error: { code: 'VALIDATION', message: "Fix the errors on the project's NPCs, objects and items first.", issues } })) }));
    await userEvent.click(await screen.findByRole('button', { name: 'Export project patch' }));
    const list = await screen.findByRole('list', { name: 'To fix' });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Hela has no look.']);
  });
});
