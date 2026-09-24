// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LeafletMapProps } from '../../src/renderer/map/LeafletMap';
import { createAppStore } from '../../src/renderer/state/app-store';
import { QuestFlowView } from '../../src/renderer/views/QuestFlowView';
import { NamesProvider } from '../../src/renderer/state/names';
import { RewardTablesProvider } from '../../src/renderer/state/reward-tables';
import { SpawnList } from '../../src/renderer/entities/SpawnList';
import { MapOpenerProvider } from '../../src/renderer/map/MapOpener';
import { registry } from '@core/registry';
import { createNewAggregate } from '@core/import/new-quest';
import { loadSchema } from '@core/schema/load';
import { ENTITIES_FIELD, newNpc, writeEntities } from '../../src/core/entities/model';
import { forkDb } from '../helpers/fixtures';
import { makeMockApi, okv, sampleOpen } from './mock-api';

vi.mock('../../src/renderer/map/LeafletMap', () => ({
  LeafletMap: (_props: LeafletMapProps) => <div aria-label="Leaflet stand-in" />,
}));

async function mountFlow() {
  const schema = await loadSchema(forkDb(), registry.tables.map((t) => t.table));
  const a = createNewAggregate(schema, registry, 60123);
  const values = { ...a.values, creature_queststarter: [{ id: 12000005 }], [ENTITIES_FIELD]: writeEntities({ npcs: [{ ...newNpc(12000005), name: 'Hela' }], objects: [] }) };
  const open = sampleOpen({ questId: 60123, aggregate: { ...a, values } });
  const api = makeMockApi({ newQuest: vi.fn(async () => okv(open)) });
  const store = createAppStore(api, { saveDelayMs: 0 });
  await store.getState().newQuest();
  render(<NamesProvider api={api}><RewardTablesProvider api={api}><QuestFlowView store={store} /></RewardTablesProvider></NamesProvider>);
  return { store };
}

describe('map from a panel', () => {
  it('opens in place mode from the giver card and goes back to the giver panel on close', async () => {
    await mountFlow();
    await userEvent.click(within(screen.getByRole('list', { name: 'Modules' })).getByRole('button', { name: /^Quest Giver/ }));
    const panel = screen.getByRole('dialog', { name: 'Quest Giver' });
    await userEvent.click(within(panel).getByRole('button', { name: 'Place on map' }));
    const map = await screen.findByRole('dialog', { name: 'Quest map' });
    expect(within(map).getByText('Click where Hela should stand.')).toBeTruthy();
    await userEvent.click(within(map).getByRole('button', { name: 'Close' }));
    expect(await screen.findByRole('dialog', { name: 'Quest Giver' })).toBeTruthy();
  });

  it('offers Place on map in the spawn list of an NPC with no spawn', async () => {
    const open = vi.fn();
    render(<NamesProvider api={makeMockApi()}><MapOpenerProvider open={open}>
      <SpawnList idPrefix="npc-1" ownerKey={{ kind: 'npc', entry: 12000001 }} spawns={[]} wanders onChange={() => {}} allocate={async () => null} />
    </MapOpenerProvider></NamesProvider>);
    await userEvent.click(screen.getByRole('button', { name: 'Place on map' }));
    expect(open).toHaveBeenCalledWith({ kind: 'place', target: { kind: 'npc', entry: 12000001 } });
  });
});
