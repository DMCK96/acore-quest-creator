// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildRouteLines, disposeRouteLines } from '../../src/renderer/world3d/scene/transport/RouteLine';

const p = (x: number, y: number) => ({ x, y, z: 3 });

describe('the route line', () => {
  it('draws a line through a run’s points and a marker on each stop', () => {
    const group = buildRouteLines([{ points: [p(0, 0), p(10, 0), p(20, 5)], stops: [{ node: 1, ...p(10, 0) }] }]);
    const lines = group.children.filter((c) => c.name === 'route') as THREE.Line[];
    const stops = group.children.filter((c) => c.name === 'stop');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.geometry.getAttribute('position').count).toBe(3);
    expect(stops.map((s) => [s.position.x, s.position.y, s.position.z])).toEqual([[10, 0, 3]]);
  });
  it('draws no line for a run of one point, and nothing for no runs', () => {
    expect(buildRouteLines([{ points: [p(1, 1)], stops: [] }]).children).toHaveLength(0);
    expect(buildRouteLines([]).children).toHaveLength(0);
  });
  it('frees what it made', () => {
    const group = buildRouteLines([{ points: [p(0, 0), p(1, 1)], stops: [{ node: 0, ...p(0, 0) }] }]);
    const geometry = (group.children[0] as THREE.Line).geometry;
    let freed = 0;
    geometry.addEventListener('dispose', () => (freed += 1));
    disposeRouteLines(group);
    expect(freed).toBe(1);
    expect(group.children).toHaveLength(0);
  });
});
