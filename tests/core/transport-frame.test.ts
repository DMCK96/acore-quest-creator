import { describe, expect, it } from 'vitest';
import { IDENTITY_FRAME, defaultNode, frameAt, hostRuns, placementToLocal, placementToWorld, toLocal, toWorld } from '../../src/core/map/transport-frame';
import { NODE_STOP, type TaxiNode } from '../../src/core/game/taxi-path';

const n = (index: number, map: number, x: number, y: number, z = 0, flags = 0): TaxiNode => ({ index, map, x, y, z, flags, delay: 0 });
const HALF = Math.PI / 2;

describe('the frame of a node', () => {
  const path = [n(0, 1, 0, 0), n(1, 1, 10, 0), n(2, 1, 10, 10)];
  it('heads towards the next node', () => {
    expect(frameAt(path, 0)).toEqual({ x: 0, y: 0, z: 0, heading: 0 });
    expect(frameAt(path, 1).heading).toBeCloseTo(HALF);
  });
  it('keeps the previous heading at the last node', () => {
    expect(frameAt(path, 2)).toMatchObject({ x: 10, y: 10, heading: expect.closeTo(HALF) });
  });
  it('ignores neighbours on another map, and a path of one node faces 0', () => {
    expect(frameAt([n(0, 1, 0, 0), n(1, 1, 10, 0), n(2, 0, 500, 500)], 1).heading).toBeCloseTo(0);
    expect(frameAt([n(0, 1, 3, 4, 5)], 0)).toEqual({ x: 3, y: 4, z: 5, heading: 0 });
    expect(frameAt([n(0, 1, 0, 0), n(1, 0, 9, 9)], 0).heading).toBe(0);
  });
  it('never gives NaN for an index outside the path', () => {
    expect(frameAt(path, 99)).toEqual(IDENTITY_FRAME);
    expect(frameAt([], 0)).toEqual(IDENTITY_FRAME);
  });
});

describe('vessel-local and world points', () => {
  const frame = { x: 100, y: 200, z: 5, heading: HALF };
  it('turns the vessel’s forward (x) towards the heading', () => {
    const w = toWorld(frame, { x: 1, y: 0, z: 2 });
    expect([w.x, w.y, w.z].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([100, 201, 7]);
  });
  it('round-trips', () => {
    const local = { x: -3.5, y: 8.25, z: -20 };
    const back = toLocal(frame, toWorld(frame, local));
    expect(back.x).toBeCloseTo(local.x);
    expect(back.y).toBeCloseTo(local.y);
    expect(back.z).toBeCloseTo(local.z);
  });
  it('is the identity for the identity frame', () => {
    expect(toWorld(IDENTITY_FRAME, { x: 1, y: 2, z: 3 })).toEqual({ x: 1, y: 2, z: 3 });
  });
});

describe('placements', () => {
  const frame = { x: 0, y: 0, z: 0, heading: HALF };
  it('adds the heading to a facing and keeps it in 0..2π on the way back', () => {
    const w = placementToWorld(frame, { x: 1, y: 0, z: 0, orientation: 0, rotation: null });
    expect(w.orientation).toBeCloseTo(HALF);
    expect(w.rotation).toBeNull();
    const l = placementToLocal(frame, w);
    expect(l.orientation).toBeCloseTo(0);
    expect(l.x).toBeCloseTo(1);
    const wrap = placementToLocal(frame, { x: 0, y: 0, z: 0, orientation: 0.1, rotation: null });
    expect(wrap.orientation).toBeGreaterThan(0);
    expect(wrap.orientation).toBeLessThan(2 * Math.PI);
  });
  it('turns an object’s rotation about Z by the heading', () => {
    const w = placementToWorld(frame, { x: 0, y: 0, z: 0, orientation: 0, rotation: [0, 0, 0, 1] });
    expect(w.rotation![2]).toBeCloseTo(Math.sin(HALF / 2));
    expect(w.rotation![3]).toBeCloseTo(Math.cos(HALF / 2));
  });
  it('treats an all-zero rotation (older rows) as upright', () => {
    const w = placementToWorld(frame, { x: 0, y: 0, z: 0, orientation: 0, rotation: [0, 0, 0, 0] });
    expect(w.rotation![3]).toBeCloseTo(Math.cos(HALF / 2));
    const back = placementToLocal(frame, w);
    expect(back.rotation![2]).toBeCloseTo(0);
    expect(back.rotation![3]).toBeCloseTo(1);
  });
});

describe('runs and the default node', () => {
  const path = [n(0, 1, 0, 0), n(1, 1, 1, 0, 0, NODE_STOP), n(2, 0, 5, 5), n(3, 0, 6, 6, 0, NODE_STOP), n(4, 1, 7, 7)];
  it('splits a path where it changes map', () => {
    expect(hostRuns(path).map((r) => [r.map, r.nodes.map((x) => x.index)])).toEqual([[1, [0, 1]], [0, [2, 3]], [1, [4]]]);
    expect(hostRuns([])).toEqual([]);
  });
  it('starts at the first stop on a drawable map, else the first drawable node, else none', () => {
    expect(defaultNode(path, () => true)).toBe(1);
    expect(defaultNode(path, (m) => m === 0)).toBe(3);
    expect(defaultNode([n(0, 7, 0, 0), n(1, 1, 1, 1)], (m) => m === 1)).toBe(1);
    expect(defaultNode(path, () => false)).toBe(-1);
    expect(defaultNode([n(0, 1, 0, 0), n(1, 1, 5, 0)], () => true)).toBe(0);
  });
});
