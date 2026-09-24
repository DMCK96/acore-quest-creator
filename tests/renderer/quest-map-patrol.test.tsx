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
import { addPoint, newPatrol } from '../../src/core/map/patrol';
import type { FieldValue } from '../../src/core/registry/types';
import type { Api } from '@shared/ipc';

let lastProps: LeafletMapProps | null = null;
vi.mock('../../src/renderer/map/LeafletMap', () => ({
  LeafletMap: (props: LeafletMapProps) => {
    lastProps = props;
    return <ul aria-label="Map markers">{props.markers.map((m) => <li key={m.id}>{m.label}</li>)}</ul>;
  },
}));

const spawnAt = { ...newSpawn(900), map: 0, x: 0, y: 0, z: 50 };
const valuesWith = (patrol: Patrol | null, spawns = [{ ...spawnAt, patrol }]) =>
  ({ ...sampleOpen().aggregate.values, [ENTITIES_FIELD]: writeEntities({ npcs: [{ ...newNpc(12000001), name: 'Hela', spawns }], objects: [] }) });

let current: Record<string, unknown> = {};
function Live({ api, values, mode }: { api: Api; values: Record<string, unknown>; mode: MapMode }) {
  const [vals, setVals] = useState(values);
  current = vals;
  const base = sampleOpen();
  const open = { ...base, aggregate: { ...base.aggregate, values: vals as Record<string, FieldValue> } };
  return <NamesProvider api={api}><QuestMapView open={open} focusId={null} onClose={vi.fn()} mode={mode}
    onChange={(field, value) => setVals((v) => { const next = { ...v, [field]: value }; current = next; return next; })} /></NamesProvider>;
}
const patrolNow = () => readEntities(current).npcs[0]?.spawns[0]?.patrol ?? null;
const PATROL: MapMode = { kind: 'patrol', entry: 12000001, guid: 900 };
const floorsApi = (over: Record<string, any> = {}) => makeMockApi({ mapFloors: vi.fn(async () => okv({ floors: [49, 60], ground: 49 })), ...over });

describe('drawing a patrol', () => {
  it('gets a path id for a spawn with no patrol yet', async () => {
    const api = floorsApi({ patrolPathId: vi.fn(async () => okv(9000)) });
    render(<Live api={api} values={valuesWith(null)} mode={PATROL} />);
    await waitFor(() => expect(patrolNow()).toEqual(newPatrol(9000)));
    expect(api.patrolPathId).toHaveBeenCalledWith(900);
    expect(screen.getByText('Click the map to add a point. Right-click a point for what it does there.')).toBeTruthy();
  });

  it('adds a point per click, on the floor nearest the last one', async () => {
    render(<Live api={floorsApi()} values={valuesWith(newPatrol(9000))} mode={PATROL} />);
    await screen.findByRole('heading', { name: 'Patrol: Hela' });
    await act(async () => lastProps!.onMapClick({ x: 10, y: 0 }));
    await waitFor(() => expect(patrolNow()!.points).toHaveLength(1));
    expect(patrolNow()!.points[0]).toMatchObject({ x: 10, y: 0, z: 49 });
    expect(lastProps!.markers.map((m) => m.id)).toContain('patrol:12000001:900:0');
    expect(lastProps!.routes).toEqual([expect.objectContaining({ id: 'patrol:12000001:900', active: true })]);
  });

  it('refuses a point on another map', async () => {
    render(<Live api={floorsApi()} values={valuesWith(newPatrol(9000))} mode={PATROL} />);
    await screen.findByRole('heading', { name: 'Patrol: Hela' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Map' }), 'Kalimdor');
    await act(async () => lastProps!.onMapClick({ x: 10, y: 0 }));
    expect(await screen.findByText('A patrol stays on Eastern Kingdoms.')).toBeTruthy();
    expect(patrolNow()!.points).toHaveLength(0);
  });

  it('inserts a point on the segment clicked', async () => {
    const two = addPoint(addPoint(newPatrol(9000), { x: 10, y: 0, z: 50 }), { x: 10, y: 10, z: 50 });
    render(<Live api={floorsApi()} values={valuesWith(two)} mode={PATROL} />);
    await screen.findByRole('heading', { name: 'Patrol: Hela' });
    await act(async () => lastProps!.onRouteClick!('patrol:12000001:900', { x: 5, y: -1 }));
    await waitFor(() => expect(patrolNow()!.points).toHaveLength(3));
    expect(patrolNow()!.points.map((p) => p.x)).toEqual([5, 10, 10]);
  });

  it('sets a point\'s wait and pace in the panel, and the starting pace', async () => {
    const one = addPoint(addPoint(newPatrol(9000), { x: 10, y: 0, z: 50 }), { x: 10, y: 10, z: 50 });
    render(<Live api={floorsApi()} values={valuesWith(one)} mode={PATROL} />);
    await screen.findByRole('heading', { name: 'Patrol: Hela' });
    await userEvent.click(screen.getByRole('button', { name: 'Point 2' }));
    const point = screen.getByRole('region', { name: 'Point 2' });
    await userEvent.clear(within(point).getByLabelText('Wait (seconds)'));
    await userEvent.type(within(point).getByLabelText('Wait (seconds)'), '6');
    await userEvent.selectOptions(within(point).getByLabelText('Pace from here'), 'Run from here');
    await userEvent.selectOptions(screen.getByLabelText('Starts'), 'Running');
    expect(patrolNow()!.points[1]).toMatchObject({ waitSecs: 6, paceFromHere: 'run' });
    expect(patrolNow()!.startPace).toBe('run');
  });

  it('removing the selected point clears the selection', async () => {
    const two = addPoint(addPoint(newPatrol(9000), { x: 10, y: 0, z: 50 }), { x: 10, y: 10, z: 50 });
    render(<Live api={floorsApi()} values={valuesWith(two)} mode={PATROL} />);
    await screen.findByRole('heading', { name: 'Patrol: Hela' });
    await userEvent.click(screen.getByRole('button', { name: 'Point 2' }));
    await userEvent.click(within(screen.getByRole('region', { name: 'Point 2' })).getByRole('button', { name: 'Remove point' }));
    expect(patrolNow()!.points).toHaveLength(1);
    expect(screen.queryByRole('region', { name: /^Point / })).toBeNull();
  });

  it('clears the route but keeps its path id, and Done leaves patrol mode', async () => {
    const two = addPoint(addPoint(newPatrol(9000), { x: 10, y: 0, z: 50 }), { x: 10, y: 10, z: 50 });
    render(<Live api={floorsApi()} values={valuesWith(two)} mode={PATROL} />);
    await screen.findByRole('heading', { name: 'Patrol: Hela' });
    await userEvent.click(screen.getByRole('button', { name: 'Clear route' }));
    expect(patrolNow()).toEqual({ ...newPatrol(9000) });
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('heading', { name: 'Patrol: Hela' })).toBeNull();
    expect(lastProps!.markers.some((m) => m.kind === 'patrolPoint')).toBe(false);
  });

  it('leaves patrol mode when its spawn is removed', async () => {
    const api = floorsApi();
    const view = render(<NamesProvider api={api}><QuestMapView open={{ ...sampleOpen(), aggregate: { ...sampleOpen().aggregate, values: valuesWith(newPatrol(9000)) as any } }}
      onChange={vi.fn()} focusId={null} onClose={vi.fn()} mode={PATROL} /></NamesProvider>);
    await screen.findByRole('heading', { name: 'Patrol: Hela' });
    view.rerender(<NamesProvider api={api}><QuestMapView open={{ ...sampleOpen(), aggregate: { ...sampleOpen().aggregate, values: valuesWith(null, []) as any } }}
      onChange={vi.fn()} focusId={null} onClose={vi.fn()} mode={PATROL} /></NamesProvider>);
    expect(await screen.findByText('That spawn is no longer in the quest.')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Patrol: Hela' })).toBeNull();
  });
});
