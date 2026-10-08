import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { selectLightsForPosition } from '../../src/renderer/world3d/scene/map/light/util';

const light = (id: number, x: number, falloffStart: number, falloffEnd: number) =>
  ({ id, mapId: 0, position: new THREE.Vector3(x, 0, 0), falloffStart, falloffEnd, params: [] }) as never;

const total = (picked: { weight: number }[]) => picked.reduce((sum, p) => sum + p.weight, 0);

describe('selecting lights for a position', () => {
  it('weights the lights in range to sum to one when the map has no default light', () => {
    // Only the edge of one light reaches here: its own weight is 0.3, and nothing takes the rest
    const picked = selectLightsForPosition([light(1, 0, 100, 200), light(2, 5000, 10, 20)], new THREE.Vector3(170, 0, 0));
    expect(picked).toHaveLength(1);
    expect(total(picked)).toBeCloseTo(1, 9);
  });

  it('keeps the split between lights that already fill the weight', () => {
    const picked = selectLightsForPosition([light(1, 0, 0, 100), light(2, 120, 0, 100)], new THREE.Vector3(60, 0, 0));
    expect(total(picked)).toBeCloseTo(1, 9);
    expect(picked.map((p) => p.light.id)).toEqual([1, 2]);
  });

  it('gives the nearest light everything where the lights in range have no weight left to give', () => {
    const picked = selectLightsForPosition([light(1, 0, 100, 200)], new THREE.Vector3(200, 0, 0));
    expect(picked).toHaveLength(1);
    expect(picked[0].weight).toBe(1);
  });

  it('selects nothing outside every light', () => {
    expect(selectLightsForPosition([light(1, 0, 100, 200)], new THREE.Vector3(900, 0, 0))).toEqual([]);
  });
});
