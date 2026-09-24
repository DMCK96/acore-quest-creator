// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LeafletMapProps } from '../../src/renderer/map/LeafletMap';
import { QuestMapView } from '../../src/renderer/map/QuestMapView';
import { NamesProvider } from '../../src/renderer/state/names';
import { makeMockApi, okv, sampleOpen } from './mock-api';
import { ENTITIES_FIELD, newNpc, newSpawn, readEntities, writeEntities } from '../../src/core/entities/model';

// Leaflet does not run in jsdom: the stand-in lists what it is given and exposes its callbacks.
let lastProps: LeafletMapProps | null = null;
vi.mock('../../src/renderer/map/LeafletMap', () => ({
  LeafletMap: (props: LeafletMapProps) => {
    lastProps = props;
    return <ul aria-label="Map markers">{props.markers.map((m) => <li key={m.id}>{m.label}</li>)}</ul>;
  },
}));

const hela = { ...newNpc(12000001), name: 'Hela', spawns: [{ ...newSpawn(900), map: 0, x: -8900, y: -160, z: 82 }] };
const openWith = (npcs = [hela]) => {
  const base = sampleOpen();
  return { ...base, aggregate: { ...base.aggregate, values: { ...base.aggregate.values, [ENTITIES_FIELD]: writeEntities({ npcs, objects: [] }) } } };
};
const mount = (api = makeMockApi(), onChange = vi.fn(), open = openWith()) => {
  render(<NamesProvider api={api}><QuestMapView open={open} onChange={onChange} focusId={null} onClose={vi.fn()} /></NamesProvider>);
  return { api, onChange };
};

describe('quest map', () => {
  it('shows the quest\'s markers on the map of its first spawn', async () => {
    mount();
    expect(await screen.findByRole('dialog', { name: 'Quest map' })).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Map markers' })).getByText('Hela · spawn 1')).toBeTruthy();
    expect(lastProps!.map).toBe(0);
    expect(lastProps!.center).toEqual({ x: -8900, y: -160 });
  });

  it('keeps a dragged spawn on the floor nearest where it was', async () => {
    const api = makeMockApi({ mapFloors: vi.fn(async () => okv({ floors: [82.18, 98.12, 127.4], ground: 82.1 })) });
    const { onChange } = mount(api);
    await screen.findByRole('dialog', { name: 'Quest map' });
    lastProps!.onMarkerMoved('spawn:npc:12000001:900', { x: -8901, y: -161 });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const [field, value] = onChange.mock.calls.at(-1)!;
    expect(field).toBe(ENTITIES_FIELD);
    expect(readEntities({ [ENTITIES_FIELD]: value }).npcs[0]!.spawns[0]).toMatchObject({ x: -8901, y: -161, z: 82.18 });
    expect(await screen.findByRole('button', { name: 'Floor 98.12' })).toBeTruthy();
  });

  it('moves a spawn without touching Z when there is no floor data, and says so', async () => {
    const api = makeMockApi({ mapFloors: vi.fn(async () => okv({ reason: 'Set the server data folder on the connection to read floors.' })) });
    const { onChange } = mount(api);
    await screen.findByRole('dialog', { name: 'Quest map' });
    lastProps!.onMarkerMoved('spawn:npc:12000001:900', { x: -8901, y: -161 });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(readEntities({ [ENTITIES_FIELD]: onChange.mock.calls.at(-1)![1] }).npcs[0]!.spawns[0]).toMatchObject({ x: -8901, z: 82 });
    expect(await screen.findByText(/Z not checked/)).toBeTruthy();
  });

  it('adds a spawn for a new NPC where the author clicks', async () => {
    const api = makeMockApi({ allocateIds: vi.fn(async () => okv([901])), mapFloors: vi.fn(async () => okv({ floors: [], ground: 70 })) });
    const { onChange } = mount(api);
    await screen.findByRole('dialog', { name: 'Quest map' });
    lastProps!.onMapClick({ x: -8800, y: -150 });
    await userEvent.click(await screen.findByRole('button', { name: 'Add a spawn here for Hela' }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(readEntities({ [ENTITIES_FIELD]: onChange.mock.calls.at(-1)![1] }).npcs[0]!.spawns[1]).toMatchObject({ guid: 901, map: 0, x: -8800, y: -150, z: 70 });
    expect(api.allocateIds).toHaveBeenCalledWith('creatureSpawn', 1);
  });

  it('lists markers on maps it does not show instead of drawing them', async () => {
    const elsewhere = { ...hela, spawns: [{ ...newSpawn(902), map: 36, x: 1, y: 1, z: 1 }] };
    mount(makeMockApi(), vi.fn(), openWith([hela, { ...elsewhere, entry: 12000002, name: 'Deep' }]));
    await screen.findByRole('dialog', { name: 'Quest map' });
    expect(within(screen.getByRole('list', { name: 'Map markers' })).queryByText('Deep · spawn 1')).toBeNull();
    expect(screen.getByText('Deep · spawn 1 is on a map this view does not show yet.')).toBeTruthy();
  });

  it('shows the quest giver\'s existing spawn as a reference', async () => {
    const api = makeMockApi({ questMapRefs: vi.fn(async () => okv([{ kind: 'creature', guid: 79970, entry: 197, name: 'Marshal McBride', map: 0, x: -8902, y: -162, z: 82, role: 'giver' }])) });
    mount(api);
    expect(await within(screen.getByRole('list', { name: 'Map markers' })).findByText('Marshal McBride (quest giver)')).toBeTruthy();
    expect(lastProps!.markers.find((m) => m.label === 'Marshal McBride (quest giver)')!.draggable).toBe(false);
  });
});
