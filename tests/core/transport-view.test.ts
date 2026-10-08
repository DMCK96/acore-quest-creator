import { describe, expect, it } from 'vitest';
import { NODE_STOP, type TaxiNode } from '../../src/core/game/taxi-path';
import { frameOfView, hostMapIdOf, nodeOptions, normaliseView, routeLinesOf, stopsOf, templateOf } from '../../src/core/map/transport-view';
import type { WorldMap } from '../../src/core/map/world-maps';

const n = (index: number, map: number, x: number, y: number, flags = 0): TaxiNode => ({ index, map, x, y, z: 1, flags, delay: 0 });
const map: WorldMap = {
  id: 672, name: 'Gunship', directory: 'IcecrownCitadel', kind: 'transport', start: { x: 0, y: 0, z: 0 },
  transport: {
    templates: [{ entry: 1, name: 'A', displayId: 9, pathId: 10 }, { entry: 2, name: 'B', displayId: 9, pathId: 20 }],
    paths: { 10: [n(0, 631, 0, 0), n(1, 631, 10, 0, NODE_STOP), n(2, 1, 99, 99), n(3, 631, 50, 50)], 20: [n(0, 631, 5, 5)] },
  },
};
const drawable = (id: number) => id === 631 || id === 1;

describe('the transport view', () => {
  it('lists a route’s stops in order, those on drawable terrain, named by `nameOf`', () => {
    const two = { ...map, transport: { ...map.transport!, paths: { ...map.transport!.paths, 10: [n(0, 1, 0, 0, NODE_STOP), n(1, 631, 10, 0), n(2, 631, 20, 0, NODE_STOP), n(3, 9, 30, 0, NODE_STOP)] } } };
    expect(stopsOf(two, 1, (at) => `M${at.map}`, drawable).map((s) => [s.node, s.label])).toEqual([[0, 'M1'], [2, 'M631']]);
  });
  it('starts at the first template’s first stop', () => {
    expect(normaliseView(map, undefined, drawable)).toEqual({ template: 1, node: 1 });
  });
  it('keeps a saved view that is valid and repairs one that is not', () => {
    expect(normaliseView(map, { template: 2, node: 0 }, drawable)).toEqual({ template: 2, node: 0 });
    expect(normaliseView(map, { template: 99, node: 0 }, drawable)).toEqual({ template: 1, node: 0 });
    expect(normaliseView(map, { template: 1, node: 77 }, drawable)).toEqual({ template: 1, node: 1 });
    expect(normaliseView(map, { template: 1, node: Number.NaN }, drawable)).toEqual({ template: 1, node: 1 });
    expect(normaliseView(map, { template: 1, node: 2 }, (id) => id === 631)).toEqual({ template: 1, node: 1 });
  });
  it('finds the template, the frame and the host map', () => {
    const view = { template: 1, node: 1 };
    expect(templateOf(map, view).pathId).toBe(10);
    expect(frameOfView(map, view)).toMatchObject({ x: 10, y: 0, z: 1 });
    expect(hostMapIdOf(map, view)).toBe(631);
    expect(hostMapIdOf(map, { template: 1, node: 2 })).toBe(1);
  });
  it('switching template changes the route and nothing else about the map', () => {
    expect(templateOf(map, { template: 2, node: 0 }).pathId).toBe(20);
    expect(map.id).toBe(672);
  });
  it('draws only the runs on the host map, with the stops marked', () => {
    const lines = routeLinesOf(map, { template: 1, node: 1 });
    expect(lines).toHaveLength(2);
    expect(lines[0]!.points.map((p) => [p.x, p.y])).toEqual([[0, 0], [10, 0]]);
    expect(lines[0]!.stops).toEqual([{ node: 1, x: 10, y: 0, z: 1 }]);
    expect(lines[1]!.points).toHaveLength(1);
    expect(routeLinesOf(map, { template: 1, node: 2 }).flatMap((l) => l.points)).toEqual([{ x: 99, y: 99, z: 1 }]);
  });
  it('gives a route with nothing on the host map no lines', () => {
    const lonely: WorldMap = { ...map, transport: { templates: [map.transport!.templates[0]!], paths: { 10: [n(0, 777, 1, 1)] } } };
    expect(routeLinesOf(lonely, { template: 1, node: 0 })).toEqual([]);
  });
  it('lists stops first, each labelled with where it is', () => {
    const options = nodeOptions(map, { template: 1, node: 1 }, (id) => (id === 631 ? 'Icecrown Citadel' : 'Kalimdor'));
    expect(options.map((o) => [o.node, o.stop, o.label])).toEqual([
      [1, true, 'Stop 1 · Icecrown Citadel'],
      [0, false, 'Point 1 · Icecrown Citadel'],
      [2, false, 'Point 3 · Kalimdor'],
      [3, false, 'Point 4 · Icecrown Citadel'],
    ]);
  });
});
