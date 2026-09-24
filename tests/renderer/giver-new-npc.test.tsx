// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mountBody } from './module-harness';
import { makeMockApi, okv, errv } from './mock-api';
import { ENTITIES_FIELD, newNpc, newSpawn, readEntities, writeEntities } from '../../src/core/entities/model';

const entitiesOf = (onChange: ReturnType<typeof vi.fn>) =>
  readEntities({ [ENTITIES_FIELD]: onChange.mock.calls.filter(([f]) => f === ENTITIES_FIELD).at(-1)![1] });

describe('giver card: new NPC', () => {
  it('makes a new quest-giving NPC and puts it on the card', async () => {
    const api = makeMockApi({ allocateIds: vi.fn(async () => okv([12000005])) });
    const { onChange } = await mountBody('giver', { creature_queststarter: [{ id: 0 }] }, { api });
    await userEvent.click(screen.getByRole('button', { name: 'New NPC for starts at 1' }));
    expect(api.allocateIds).toHaveBeenCalledWith('creature', 1);
    expect(entitiesOf(onChange).npcs).toEqual([expect.objectContaining({ entry: 12000005, questGiver: true, name: '' })]);
    expect(onChange).toHaveBeenCalledWith('creature_queststarter', [{ id: 12000005 }]);
  });

  it('says why when no NPC id could be had', async () => {
    const api = makeMockApi({ allocateIds: vi.fn(async () => errv('CONNECTION', 'The database is not reachable.')) });
    const { onChange } = await mountBody('giver', { creature_queststarter: [{ id: 0 }] }, { api });
    await userEvent.click(screen.getByRole('button', { name: 'New NPC for starts at 1' }));
    expect(await screen.findByText('The database is not reachable.')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('names a project NPC on the card and offers to place it', async () => {
    const openMap = vi.fn();
    const values = { creature_queststarter: [{ id: 12000005 }], [ENTITIES_FIELD]: writeEntities({ npcs: [{ ...newNpc(12000005), questGiver: true }], objects: [] }) };
    const { onChange } = await mountBody('giver', values, { openMap });
    const card = screen.getByRole('region', { name: 'Starts at 1' });
    expect(within(card).getByText('Made with this quest. Set its level, model and more in NPCs & objects.')).toBeTruthy();
    await userEvent.type(within(card).getByLabelText('NPC name'), 'H');
    expect(entitiesOf(onChange).npcs[0]!.name).toBe('H');
    await userEvent.click(within(card).getByRole('button', { name: 'Place on map' }));
    expect(openMap).toHaveBeenCalledWith({ kind: 'place', target: { kind: 'npc', entry: 12000005 } });
    expect(within(card).queryByRole('button', { name: 'Draw patrol' })).toBeNull();
  });

  it('shows a placed NPC on the map and offers its patrol', async () => {
    const openMap = vi.fn();
    const npc = { ...newNpc(12000005), name: 'Hela', spawns: [{ ...newSpawn(900), x: 1, y: 2 }] };
    await mountBody('giver', { creature_queststarter: [{ id: 12000005 }], [ENTITIES_FIELD]: writeEntities({ npcs: [npc], objects: [] }) }, { openMap });
    const card = screen.getByRole('region', { name: 'Starts at 1' });
    await userEvent.click(within(card).getByRole('button', { name: 'Show on map' }));
    expect(openMap).toHaveBeenCalledWith('spawn:npc:12000005:900');
    await userEvent.click(within(card).getByRole('button', { name: 'Draw patrol' }));
    expect(openMap).toHaveBeenCalledWith({ kind: 'patrol', entry: 12000005, guid: 900 });
  });

  it('shows no name field or map buttons for an NPC already in the world', async () => {
    await mountBody('giver', { creature_queststarter: [{ id: 240 }] }, { openMap: vi.fn() });
    const card = screen.getByRole('region', { name: 'Starts at 1' });
    expect(within(card).queryByLabelText('NPC name')).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Place on map' })).toBeNull();
  });

  it('offers no new NPC on an object card', async () => {
    await mountBody('giver', { gameobject_queststarter: [{ id: 0 }] });
    expect(screen.queryByRole('button', { name: 'New NPC for starts at 1' })).toBeNull();
  });
});

describe('giver card: new NPC after a wait', () => {
  it('keeps edits made while the new NPC id was on its way', async () => {
    const { render, act } = await import('@testing-library/react');
    const { ModuleBody } = await import('../../src/renderer/modules/ModuleBody');
    const { NamesProvider } = await import('../../src/renderer/state/names');
    const { sampleOpen } = await import('./mock-api');
    let answer: (v: unknown) => void = () => {};
    const api = makeMockApi({ allocateIds: vi.fn(() => new Promise((resolve) => { answer = resolve; })) });
    const onChange = vi.fn();
    const openWith = (values: Record<string, unknown>) => {
      const base = sampleOpen();
      return { ...base, aggregate: { ...base.aggregate, values: { ...base.aggregate.values, ...values } as never } };
    };
    const ui = (values: Record<string, unknown>) => (
      <NamesProvider api={api}><ModuleBody id="giver" open={openWith(values)} links={null} onChange={onChange} onOpenQuest={vi.fn()} /></NamesProvider>
    );
    const view = render(ui({ creature_queststarter: [{ id: 0 }] }));
    await userEvent.click(screen.getByRole('button', { name: 'New NPC for starts at 1' }));
    // Meanwhile another NPC was made and the quest gained an ender.
    const other = { ...newNpc(12000004), name: 'Other' };
    view.rerender(ui({ creature_queststarter: [{ id: 0 }], creature_questender: [{ id: 240 }], [ENTITIES_FIELD]: writeEntities({ npcs: [other], objects: [] }) }));
    await act(async () => answer(okv([12000005])));
    expect(entitiesOf(onChange).npcs.map((n) => n.entry)).toEqual([12000004, 12000005]);
    expect(onChange).toHaveBeenCalledWith('creature_queststarter', [{ id: 12000005 }]);
    expect(onChange).not.toHaveBeenCalledWith('creature_questender', []);
  });
});
