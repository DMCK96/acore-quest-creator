import { describe, expect, it } from 'vitest';
import type { SpawnDot } from '../../../src/core/db/spawns';
import { EMPTY_WORLD, type WorldLayer } from '../../../src/core/world/layer';
import { overlayFound, overlayView } from '../../../src/core/world/overlay-spawns';
import type { ProjectEntities } from '../../../src/core/entities/model';
import type { ViewCreature, ViewSpawns } from '../../../src/core/db/view-spawns';

const entities = { npcs: [], objects: [], items: [] } as unknown as ProjectEntities;
const place = (x: number, y: number, z = 0) => ({ x, y, z, orientation: 0, rotation: null });
const dot = (guid: number, x: number, y: number, map = 0): SpawnDot => ({ kind: 'creature', guid, entry: 1423, name: 'Guard', map, x, y, z: 0 });
const look = { displayId: 5, scale: 1, equipment: [0, 0, 0] as [number, number, number], preset: null };
const layerWith = (over: Partial<WorldLayer>): WorldLayer => ({ ...EMPTY_WORLD, ...over });
const move = (guid: number, to: ReturnType<typeof place>, from: ReturnType<typeof place>) => ({ kind: 'creature' as const, guid, entry: 1423, name: 'Guard', map: 0, original: from, current: to });
const deleted = (guid: number, x: number, y: number) => ({ kind: 'creature' as const, guid, entry: 1423, name: 'Guard', map: 0, placement: place(x, y), rows: [] });

describe('overlayFound', () => {
  it('reports a moved spawn at its new place, with where the database has it', () => {
    const [out] = overlayFound([dot(1, 10, 10)], layerWith({ spawns: [move(1, place(50, 60), place(10, 10))] }), entities, 'creature', 1423);
    expect(out).toMatchObject({ guid: 1, x: 50, y: 60, source: 'project', movedFrom: { map: 0, x: 10, y: 10, z: 0 } });
  });
  it('leaves out a deleted spawn and includes one placed in the view', () => {
    const layer = layerWith({
      deletes: [deleted(1, 10, 10)],
      added: [{ kind: 'creature', guid: 9, entry: 1423, name: 'Guard', map: 0, placement: place(1, 2), look }],
    });
    const out = overlayFound([dot(1, 10, 10), dot(2, 20, 20)], layer, entities, 'creature', 1423);
    expect(out.map((s) => s.guid)).toEqual([2, 9]);
    expect(out[1]).toMatchObject({ source: 'project', x: 1, y: 2 });
    expect(out[0]!.source).toBeUndefined();
  });
  it('includes the spawns of the project own NPC of that entry', () => {
    const mine = { npcs: [{ entry: 1423, name: 'Mine', spawns: [{ guid: 7, map: 1, x: 3, y: 4, z: 5 }] }], objects: [], items: [] } as unknown as ProjectEntities;
    expect(overlayFound([], EMPTY_WORLD, mine, 'creature', 1423)).toEqual([{ kind: 'creature', guid: 7, entry: 1423, name: 'Mine', map: 1, x: 3, y: 4, z: 5, source: 'project' }]);
  });
});

describe('overlayView', () => {
  const creature = (guid: number, x: number, y: number): ViewCreature => ({
    guid, entry: 1423, name: 'Guard', map: 0, x, y, z: 0, orientation: 0, displayId: 1, scale: 1, wander: 0, path: null, pathId: 0, equipment: [0, 0, 0], own: false, event: null, events: [], removedBy: [], preset: null, group: null, respawnSecs: 300,
  });
  const view: ViewSpawns = { creatures: [creature(1, 10, 10), creature(2, 20, 20)], objects: [], capped: { creatures: false, objects: false } };
  const box = { minX: 0, maxX: 100, minY: 0, maxY: 100 };

  it('moves, drops and adds, marking what the project changed', () => {
    const layer = layerWith({
      spawns: [move(1, place(40, 40), place(10, 10))],
      deletes: [deleted(2, 20, 20)],
      added: [{ kind: 'creature', guid: 9, entry: 1423, name: 'Guard', map: 0, placement: place(5, 5), look }],
    });
    const out = overlayView(view, layer, entities, 0, box);
    expect(out.creatures.map((c) => [c.guid, c.x, c.source])).toEqual([[1, 40, 'project'], [9, 5, 'project']]);
    expect(out.creatures[0]!.movedFrom).toMatchObject({ x: 10, y: 10 });
  });
  it('lets a spawn moved out of the box leave it, and one moved in from outside come in', () => {
    const layer = layerWith({ spawns: [move(1, place(500, 500), place(10, 10)), move(77, place(30, 30), place(900, 900))] });
    const out = overlayView(view, layer, entities, 0, box);
    expect(out.creatures.map((c) => c.guid)).toEqual([2, 77]);
    expect(out.creatures[1]).toMatchObject({ source: 'project', displayId: 0 });
  });
  it('leaves an untouched area as the database gave it', () => {
    expect(overlayView(view, EMPTY_WORLD, entities, 0, box).creatures).toEqual(view.creatures);
  });
});
