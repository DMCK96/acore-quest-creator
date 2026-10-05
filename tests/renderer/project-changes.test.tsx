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
const quests = [{ questId: 60001, title: 'Wolves', uses: { npcs: [12000001], objects: [], items: [] } }];
const mount = (api = makeMockApi({
  worldChanges: vi.fn(async () => okv([])),
  exportProject: vi.fn(async () => okv({ applyPath: 'C:\\out\\a_project.sql', revertPath: 'C:\\out\\a_project_revert.sql', sql: '' })),
})) => {
  const onEdit = vi.fn();
  const onGoTo = vi.fn();
  render(
    <ProjectEntitiesProvider value={{ entities, setEntities: vi.fn(), quests, create: vi.fn(), remove: vi.fn() } as any}>
      <ProjectChanges api={api} onLayer={vi.fn()} onClose={vi.fn()} onEdit={onEdit} onGoTo={onGoTo} />
    </ProjectEntitiesProvider>,
  );
  return { api, onEdit, onGoTo };
};

describe('Project changes', () => {
  it("is titled Project changes and lists the project's NPCs and objects first", async () => {
    mount();
    const dialog = screen.getByRole('dialog', { name: 'Project changes' });
    const section = within(dialog).getByRole('region', { name: 'New NPCs, objects & items' });
    const hela = within(section).getByRole('listitem', { name: 'Hela' });
    expect(within(hela).getByText('NPC 12000001 · 1 spawn · used by Wolves')).toBeTruthy();
    const crate = within(section).getByRole('listitem', { name: 'Crate' });
    expect(within(crate).getByText('Object 9100001 · 0 spawns')).toBeTruthy();
    expect(await within(dialog).findByText('No world changes.')).toBeTruthy();
  });

  it('edits and goes to an entry', async () => {
    const { onEdit, onGoTo } = mount();
    const hela = screen.getByRole('listitem', { name: 'Hela' });
    await userEvent.click(within(hela).getByRole('button', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalledWith('npc', 12000001);
    await userEvent.click(within(hela).getByRole('button', { name: 'Go to' }));
    expect(onGoTo).toHaveBeenCalledWith('creature', expect.objectContaining({ entry: 12000001, name: 'Hela' }), expect.objectContaining({ guid: 6000001, map: 0, x: 1, y: 2, z: 3 }));
    expect(within(screen.getByRole('listitem', { name: 'Crate' })).getByRole('button', { name: 'Go to' })).toHaveProperty('disabled', true);
  });

  it('exports the project patch with only new NPCs and no world changes', async () => {
    const { api } = mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Export project patch' }));
    expect(api.exportProject).toHaveBeenCalled();
    expect(await screen.findByText(/a_project\.sql/)).toBeTruthy();
  });
});
