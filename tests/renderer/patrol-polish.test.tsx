// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LeafletMapProps } from '../../src/renderer/map/LeafletMap';
import { QuestMapView } from '../../src/renderer/map/QuestMapView';
import type { MapMode } from '../../src/renderer/map/MapOpener';
import { NamesProvider } from '../../src/renderer/state/names';
import { makeMockApi, okv, sampleOpen } from './mock-api';
import { ENTITIES_FIELD, newNpc, newSpawn, readEntities, writeEntities, type Patrol } from '../../src/core/entities/model';
import { addAction, addPoint, newPatrol } from '../../src/core/map/patrol';
import type { FieldValue } from '../../src/core/registry/types';
import type { Api } from '@shared/ipc';

let lastProps: LeafletMapProps | null = null;
vi.mock('../../src/renderer/map/LeafletMap', () => ({
  LeafletMap: (props: LeafletMapProps) => { lastProps = props; return <div aria-label="Leaflet stand-in" />; },
}));

const three = (): Patrol =>
  addPoint(addPoint(addPoint(newPatrol(9000), { x: 10, y: 0, z: 50 }), { x: 10, y: 10, z: 50 }), { x: 0, y: 10, z: 50 });
const valuesWith = (patrol: Patrol | null) => ({ ...sampleOpen().aggregate.values,
  [ENTITIES_FIELD]: writeEntities({ npcs: [{ ...newNpc(12000001), name: 'Hela', spawns: [{ ...newSpawn(900), map: 0, x: 0, y: 0, z: 50, patrol }] }], objects: [] }) });

let current: Record<string, unknown> = {};
let setOutside: (next: Record<string, unknown>) => void = () => {};
function Live({ api, values, mode = null }: { api: Api; values: Record<string, unknown>; mode?: MapMode | null }) {
  const [vals, setVals] = useState(values);
  current = vals;
  setOutside = (next) => setVals(next);
  const base = sampleOpen();
  return <NamesProvider api={api}><QuestMapView open={{ ...base, aggregate: { ...base.aggregate, values: vals as Record<string, FieldValue> } }}
    focusId={null} onClose={vi.fn()} mode={mode} onChange={(f, v) => setVals((o) => { const n = { ...o, [f]: v }; current = n; return n; })} /></NamesProvider>;
}
const patrolNow = () => readEntities(current).npcs[0]!.spawns[0]!.patrol!;
const PATROL: MapMode = { kind: 'patrol', entry: 12000001, guid: 900 };
const floorsApi = (over: Record<string, any> = {}) => makeMockApi({ mapFloors: vi.fn(async () => okv({ floors: [49, 60], ground: 49 })), ...over });

describe('patrol polish', () => {
  it('marks only the selected patrol point, and no marker once it is removed', async () => {
    render(<Live api={floorsApi()} values={valuesWith(three())} mode={PATROL} />);
    await screen.findByRole('heading', { name: 'Patrol: Hela' });
    act(() => lastProps!.onMarkerSelected('patrol:12000001:900:1'));
    expect(lastProps!.selectedId).toBe('patrol:12000001:900:1');
    await userEvent.click(within(screen.getByRole('region', { name: 'Point 2' })).getByRole('button', { name: 'Remove point' }));
    expect(patrolNow().points).toHaveLength(2);
    expect(lastProps!.selectedId).toBeNull();
  });

  it('lets go of a selected point that an outside change takes away', async () => {
    render(<Live api={floorsApi()} values={valuesWith(three())} mode={PATROL} />);
    await screen.findByRole('heading', { name: 'Patrol: Hela' });
    await userEvent.click(screen.getByRole('button', { name: 'Point 3' }));
    act(() => setOutside(valuesWith(addPoint(newPatrol(9000), { x: 10, y: 0, z: 50 }))));
    expect(screen.queryByRole('region', { name: /^Point / })).toBeNull();
    // Points coming back (a redo) must not bring back a selection the author never made again.
    act(() => setOutside(valuesWith(three())));
    expect(screen.queryByRole('region', { name: /^Point / })).toBeNull();
    expect(lastProps!.selectedId).toBeNull();
  });

  it('offers the other floors under a new patrol point and moves it to the one picked', async () => {
    render(<Live api={floorsApi()} values={valuesWith(newPatrol(9000))} mode={PATROL} />);
    await screen.findByRole('heading', { name: 'Patrol: Hela' });
    await act(async () => lastProps!.onMapClick({ x: 10, y: 0 }));
    await waitFor(() => expect(patrolNow().points).toHaveLength(1));
    expect(patrolNow().points[0]!.z).toBe(49);
    await userEvent.click(await screen.findByRole('button', { name: 'Floor 60' }));
    expect(patrolNow().points[0]!.z).toBe(60);
  });

  it('says why Z was not checked for a patrol point', async () => {
    const api = makeMockApi({ mapFloors: vi.fn(async () => okv({ reason: 'Set the server data folder on the connection to read floors.' })) });
    render(<Live api={api} values={valuesWith(newPatrol(9000))} mode={PATROL} />);
    await screen.findByRole('heading', { name: 'Patrol: Hela' });
    await act(async () => lastProps!.onMapClick({ x: 10, y: 0 }));
    expect(await screen.findByText(/Z not checked: Set the server data folder/)).toBeTruthy();
  });

  it('offers Draw patrol for a selected spawn of a new NPC', async () => {
    render(<Live api={floorsApi()} values={valuesWith(newPatrol(9000))} />);
    await screen.findByRole('dialog', { name: 'Quest map' });
    act(() => lastProps!.onMarkerSelected('spawn:npc:12000001:900'));
    await userEvent.click(within(screen.getByRole('region', { name: 'Selected position' })).getByRole('button', { name: 'Draw patrol' }));
    expect(await screen.findByRole('heading', { name: 'Patrol: Hela' })).toBeTruthy();
  });

  it('keeps the same routes while nothing about them changes', async () => {
    render(<Live api={floorsApi()} values={valuesWith(three())} />);
    await screen.findByRole('dialog', { name: 'Quest map' });
    const before = lastProps!.routes;
    await act(async () => lastProps!.onMapClick({ x: 1, y: 1 }));
    expect(screen.getByRole('region', { name: 'Add a spawn' })).toBeTruthy();
    expect(lastProps!.routes).toBe(before);
  });

  it('keeps a route already drawn when a slow path id arrives', async () => {
    let answer: (v: unknown) => void = () => {};
    const api = floorsApi({ patrolPathId: vi.fn(() => new Promise((resolve) => { answer = resolve; })) });
    render(<Live api={api} values={valuesWith(null)} mode={PATROL} />);
    await waitFor(() => expect(api.patrolPathId).toHaveBeenCalled());
    act(() => setOutside(valuesWith(three())));
    await act(async () => answer(okv(9010)));
    expect(patrolNow()).toEqual(three());
  });

  it('warns when an action comes after the NPC has walked on', async () => {
    const late = addAction(three(), 1, { id: 'a1', afterSecs: 12, kind: 'emote', emote: 3 });
    render(<Live api={floorsApi()} values={valuesWith(late)} mode={PATROL} />);
    await screen.findByRole('heading', { name: 'Patrol: Hela' });
    await userEvent.click(screen.getByRole('button', { name: 'Point 2' }));
    const form = screen.getByRole('group', { name: 'Plays an emote' });
    expect(within(form).getByText('It only waits 0 s here, so this may be cut short when it walks on.')).toBeTruthy();
  });
});
