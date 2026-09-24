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
import { ENTITIES_FIELD, newNpc, newSpawn, readEntities, writeEntities } from '../../src/core/entities/model';
import { addPoint, newPatrol } from '../../src/core/map/patrol';
import type { FieldValue } from '../../src/core/registry/types';
import type { Api } from '@shared/ipc';

let lastProps: LeafletMapProps | null = null;
vi.mock('../../src/renderer/map/LeafletMap', () => ({
  LeafletMap: (props: LeafletMapProps) => { lastProps = props; return <div aria-label="Leaflet stand-in" />; },
}));

const two = addPoint(addPoint(newPatrol(9000), { x: 10, y: 0, z: 50 }), { x: 10, y: 10, z: 50 });
const start = () => ({ ...sampleOpen().aggregate.values,
  [ENTITIES_FIELD]: writeEntities({ npcs: [{ ...newNpc(12000001), name: 'Hela', spawns: [{ ...newSpawn(900), map: 0, x: 0, y: 0, z: 50, patrol: two }] }], objects: [] }) });
let current: Record<string, unknown> = {};
function Live({ api }: { api: Api }) {
  const [vals, setVals] = useState<Record<string, unknown>>(start());
  current = vals;
  const base = sampleOpen();
  const mode: MapMode = { kind: 'patrol', entry: 12000001, guid: 900 };
  return <NamesProvider api={api}><QuestMapView open={{ ...base, aggregate: { ...base.aggregate, values: vals as Record<string, FieldValue> } }}
    focusId={null} onClose={vi.fn()} mode={mode} onChange={(f, v) => setVals((o) => { const n = { ...o, [f]: v }; current = n; return n; })} /></NamesProvider>;
}
const point = (i: number) => readEntities(current).npcs[0]!.spawns[0]!.patrol!.points[i]!;
async function openMenu(api = makeMockApi({ mapFloors: vi.fn(async () => okv({ floors: [50], ground: 50 })) })) {
  render(<Live api={api} />);
  await screen.findByRole('heading', { name: 'Patrol: Hela' });
  await act(async () => lastProps!.onMarkerContextMenu!('patrol:12000001:900:1', { x: 100, y: 100 }));
  return screen.getByRole('menu', { name: 'Point 2' });
}

describe('what the NPC does at a point', () => {
  it('offers every choice on right-click', async () => {
    const menu = await openMenu();
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual([
      'Wait here…', 'Face direction…', 'Walk from here', 'Run from here',
      'Say something…', 'Play an emote…', 'Hold a pose while waiting…', 'Cast a spell…', 'Play a sound…', 'Mount…', 'Dismount', 'Use an object…',
      'Insert point after', 'Remove point',
    ]);
  });

  it('adds a line to say and edits it', async () => {
    const menu = await openMenu();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Say something…' }));
    expect(screen.queryByRole('menu')).toBeNull();
    const form = screen.getByRole('group', { name: 'Says' });
    await userEvent.type(within(form).getByLabelText('Line 1'), 'Halt');
    await userEvent.selectOptions(within(form).getByLabelText('Style 1'), 'Yell');
    await userEvent.click(within(form).getByRole('button', { name: 'Add line' }));
    expect(point(1).actions).toEqual([expect.objectContaining({ kind: 'say', chance: 100, lines: [{ text: 'Halt', style: 'yell' }, { text: '', style: 'say' }] })]);
  });

  it('holds a pose and waits for it', async () => {
    const menu = await openMenu();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Hold a pose while waiting…' }));
    await userEvent.selectOptions(within(screen.getByRole('group', { name: 'Holds a pose' })).getByLabelText('Pose'), 'Mining');
    expect(point(1)).toMatchObject({ waitSecs: 10, actions: [expect.objectContaining({ kind: 'pose', emoteState: 233 })] });
  });

  it('faces where the author clicks next', async () => {
    const menu = await openMenu();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Face direction…' }));
    expect(screen.getByText('Click where it should look.')).toBeTruthy();
    await act(async () => lastProps!.onMapClick({ x: 10, y: 20 }));
    await waitFor(() => expect(point(1).facing).toBeCloseTo(Math.PI / 2));
    expect(point(1).waitSecs).toBe(10);
    expect(readEntities(current).npcs[0]!.spawns[0]!.patrol!.points).toHaveLength(2);
    expect(screen.getByText('Facing 90°')).toBeTruthy();
  });

  it('uses an object picked on the map, and refuses an NPC', async () => {
    const menu = await openMenu();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Use an object…' }));
    expect(screen.getByText('Click an object on the map.')).toBeTruthy();
    await act(async () => lastProps!.onDotClick!({ kind: 'creature', guid: 5, entry: 6, name: 'Wolf', map: 0, x: 0, y: 0, z: 0 }));
    expect(screen.getByText('Pick an object, not an NPC.')).toBeTruthy();
    await act(async () => lastProps!.onDotClick!({ kind: 'gameobject', guid: 77001, entry: 175000, name: 'Lever', map: 0, x: 0, y: 0, z: 0 }));
    await waitFor(() => expect(point(1).actions).toEqual([expect.objectContaining({ kind: 'useObject', guid: 77001, entry: 175000 })]));
    expect(screen.queryByText('Click an object on the map.')).toBeNull();
  });

  it('plays a sound found by name', async () => {
    const api = makeMockApi({ mapFloors: vi.fn(async () => okv({ floors: [50], ground: 50 })), searchEntities: vi.fn(async () => okv([{ id: 12, name: 'GuardAlarm' }])) });
    const menu = await openMenu(api);
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Play a sound…' }));
    await userEvent.type(within(screen.getByRole('group', { name: 'Plays a sound' })).getByRole('combobox', { name: 'Sound' }), 'guard');
    await userEvent.click(await screen.findByRole('option', { name: 'GuardAlarm · #12' }));
    expect(api.searchEntities).toHaveBeenCalledWith('sound', 'guard');
    expect(point(1).actions).toEqual([expect.objectContaining({ kind: 'sound', sound: 12 })]);
  });

  it('orders, delays and removes actions', async () => {
    let menu = await openMenu();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Dismount' }));
    await act(async () => lastProps!.onMarkerContextMenu!('patrol:12000001:900:1', { x: 100, y: 100 }));
    menu = screen.getByRole('menu', { name: 'Point 2' });
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Play an emote…' }));
    const emote = screen.getByRole('group', { name: 'Plays an emote' });
    await userEvent.clear(within(emote).getByLabelText('After (seconds)'));
    await userEvent.type(within(emote).getByLabelText('After (seconds)'), '2');
    await userEvent.click(within(emote).getByRole('button', { name: 'Up' }));
    expect(point(1).actions.map((a) => a.kind)).toEqual(['emote', 'dismount']);
    expect(point(1).actions[0]!.afterSecs).toBe(2);
    await userEvent.click(within(screen.getByRole('group', { name: 'Dismounts' })).getByRole('button', { name: 'Remove' }));
    expect(point(1).actions.map((a) => a.kind)).toEqual(['emote']);
  });

  it('sets pace, inserts and removes from the menu, and closes the menu on Escape', async () => {
    let menu = await openMenu();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Run from here' }));
    expect(point(1).paceFromHere).toBe('run');
    await act(async () => lastProps!.onMarkerContextMenu!('patrol:12000001:900:0', { x: 100, y: 100 }));
    menu = screen.getByRole('menu', { name: 'Point 1' });
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Insert point after' }));
    await waitFor(() => expect(readEntities(current).npcs[0]!.spawns[0]!.patrol!.points).toHaveLength(3));
    await act(async () => lastProps!.onMarkerContextMenu!('patrol:12000001:900:1', { x: 100, y: 100 }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    await act(async () => lastProps!.onMarkerContextMenu!('patrol:12000001:900:1', { x: 100, y: 100 }));
    await userEvent.click(within(screen.getByRole('menu', { name: 'Point 2' })).getByRole('menuitem', { name: 'Remove point' }));
    expect(readEntities(current).npcs[0]!.spawns[0]!.patrol!.points).toHaveLength(2);
  });
});
