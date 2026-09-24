// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LeafletMapProps } from '../../src/renderer/map/LeafletMap';
import { QuestMapView } from '../../src/renderer/map/QuestMapView';
import { NamesProvider } from '../../src/renderer/state/names';
import { makeMockApi, okv, sampleOpen } from './mock-api';
import { ENTITIES_FIELD, newNpc, readEntities, writeEntities } from '../../src/core/entities/model';

let lastProps: LeafletMapProps | null = null;
vi.mock('../../src/renderer/map/LeafletMap', () => ({
  LeafletMap: (props: LeafletMapProps) => {
    lastProps = props;
    return <ul aria-label="Map markers">{props.markers.map((m) => <li key={m.id}>{m.label}</li>)}</ul>;
  },
}));

const unplaced = { ...newNpc(12000001), name: 'Hela' };
const openWith = () => {
  const base = sampleOpen();
  return { ...base, aggregate: { ...base.aggregate, values: { ...base.aggregate.values, [ENTITIES_FIELD]: writeEntities({ npcs: [unplaced], objects: [] }) } } };
};

describe('quest map place mode', () => {
  it('asks where the NPC should stand and places it on the next click', async () => {
    const api = makeMockApi({ allocateIds: vi.fn(async () => okv([900])), mapFloors: vi.fn(async () => okv({ floors: [81.5], ground: 81.5 })) });
    const onChange = vi.fn();
    render(<NamesProvider api={api}><QuestMapView open={openWith()} onChange={onChange} focusId={null} onClose={vi.fn()}
      mode={{ kind: 'place', target: { kind: 'npc', entry: 12000001 } }} /></NamesProvider>);
    expect(await screen.findByText('Click where Hela should stand.')).toBeTruthy();
    lastProps!.onMapClick({ x: -8800, y: -150 });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(api.allocateIds).toHaveBeenCalledWith('creatureSpawn', 1);
    const [field, value] = onChange.mock.calls.at(-1)!;
    expect(field).toBe(ENTITIES_FIELD);
    expect(readEntities({ [ENTITIES_FIELD]: value }).npcs[0]!.spawns).toEqual([
      expect.objectContaining({ guid: 900, map: 0, x: -8800, y: -150, z: 81.5 }),
    ]);
    expect(await screen.findByText('Placed. Drag to adjust, or draw its patrol.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Draw patrol' })).toBeTruthy();
    // A second click no longer places anything: it is the ordinary "add a spawn here" offer.
    lastProps!.onMapClick({ x: -8700, y: -140 });
    expect(await screen.findByRole('region', { name: 'Add a spawn' })).toBeTruthy();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('offers no patrol for a placed object', async () => {
    const api = makeMockApi({ allocateIds: vi.fn(async () => okv([700])), mapFloors: vi.fn(async () => okv({ floors: [], ground: 60 })) });
    const base = sampleOpen();
    const open = { ...base, aggregate: { ...base.aggregate, values: { [ENTITIES_FIELD]: writeEntities({ npcs: [], objects: [{ entry: 9100001, name: 'Crate', type: 'goober', displayId: 1, size: 1, spawns: [], pages: [], onlyDuringQuest: false, loot: [] }] }) } } };
    render(<NamesProvider api={api}><QuestMapView open={open} onChange={vi.fn()} focusId={null} onClose={vi.fn()}
      mode={{ kind: 'place', target: { kind: 'object', entry: 9100001 } }} /></NamesProvider>);
    expect(await screen.findByText('Click where Crate should stand.')).toBeTruthy();
    lastProps!.onMapClick({ x: 1, y: 2 });
    expect(await screen.findByText('Placed. Drag to adjust, or draw its patrol.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Draw patrol' })).toBeNull();
  });

  it('cancels without placing anything', async () => {
    const onChange = vi.fn();
    render(<NamesProvider api={makeMockApi()}><QuestMapView open={openWith()} onChange={onChange} focusId={null} onClose={vi.fn()}
      mode={{ kind: 'place', target: { kind: 'npc', entry: 12000001 } }} /></NamesProvider>);
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Click where Hela should stand.')).toBeNull();
    lastProps!.onMapClick({ x: 1, y: 2 });
    expect(await screen.findByRole('region', { name: 'Add a spawn' })).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });
});
