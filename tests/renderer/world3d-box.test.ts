import { describe, expect, it } from 'vitest';
import { boxHits, type Candidates } from '../../src/renderer/world3d/scene/edit/box';

// A stand-in projection: a point's x and y are already its place on screen, and z says in front (within -1..1) or not
const project = (at: { x: number; y: number; z: number }) => ({ ...at });
const c = (points: [number, number, number][], spawns: [number, number, number][]): Candidates => ({
  points: points.map(([x, y, z], i) => ({ guid: 7, index: i, at: { x, y, z } })),
  spawns: spawns.map(([x, y, z], i) => ({ kind: 'creature' as const, guid: 100 + i, at: { x, y, z } })),
});

describe('what a box catches', () => {
  it('route points inside it, in preference to spawns', () => {
    expect(boxHits(c([[0, 0, 0], [0.9, 0.9, 0]], [[0.1, 0.1, 0]]), project, { x0: -0.5, y0: -0.5, x1: 0.5, y1: 0.5 })).toEqual({ points: [{ guid: 7, index: 0 }] });
  });

  it('spawns inside it when no point is', () => {
    expect(boxHits(c([[0.9, 0.9, 0]], [[0.1, 0.1, 0], [-0.8, 0, 0]]), project, { x0: -0.5, y0: -0.5, x1: 0.5, y1: 0.5 })).toEqual({ spawns: [{ kind: 'creature', guid: 100 }] });
  });

  it('the same whichever way it was dragged', () => {
    expect(boxHits(c([], [[0.1, 0.1, 0]]), project, { x0: 0.5, y0: 0.5, x1: -0.5, y1: -0.5 })).toEqual({ spawns: [{ kind: 'creature', guid: 100 }] });
  });

  it('nothing behind the camera', () => {
    expect(boxHits(c([[0, 0, 2]], [[0, 0, -2]]), project, { x0: -1, y0: -1, x1: 1, y1: 1 })).toEqual({ spawns: [] });
  });
});
