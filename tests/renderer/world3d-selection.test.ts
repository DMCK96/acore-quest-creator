import { describe, expect, it } from 'vitest';
import { afterRouteChange, combine, EMPTY_SELECTION, isEmpty, type Selection } from '../../src/renderer/world3d/scene/edit/selection';

const npc = (guid: number) => ({ kind: 'creature' as const, guid });
const obj = (guid: number) => ({ kind: 'object' as const, guid });
const pt = (guid: number, index: number) => ({ guid, index });

describe('combining a hit with the selection', () => {
  it('a plain pick of spawns replaces everything and makes its NPCs’ routes active, whether or not they are drawn yet', () => {
    const before: Selection = { spawns: [obj(9)], points: [pt(2, 0)], routes: [2] };
    expect(combine(before, { spawns: [npc(1), npc(3), obj(4)] }, 'replace')).toEqual({ spawns: [npc(1), npc(3), obj(4)], points: [], routes: [1, 3] });
  });

  it('Shift adds spawns and their routes, keeping picked points and not doubling', () => {
    const before: Selection = { spawns: [npc(1)], points: [pt(1, 2)], routes: [1] };
    expect(combine(before, { spawns: [npc(1), npc(2)] }, 'add')).toEqual({ spawns: [npc(1), npc(2)], points: [pt(1, 2)], routes: [1, 2] });
  });

  it('Ctrl takes spawns out; a route stays active while any of its points is picked', () => {
    const before: Selection = { spawns: [npc(1), npc(2)], points: [pt(1, 0)], routes: [1, 2] };
    expect(combine(before, { spawns: [npc(1), npc(2)] }, 'remove')).toEqual({ spawns: [], points: [pt(1, 0)], routes: [1] });
  });

  it('a plain pick of points replaces the spawns but leaves the routes active', () => {
    const before: Selection = { spawns: [npc(1), npc(2)], points: [], routes: [1, 2] };
    expect(combine(before, { points: [pt(1, 0), pt(2, 3)] }, 'replace')).toEqual({ spawns: [], points: [pt(1, 0), pt(2, 3)], routes: [1, 2] });
  });

  it('Shift and Ctrl add and take points only', () => {
    const before: Selection = { spawns: [], points: [pt(1, 0)], routes: [1] };
    const added = combine(before, { points: [pt(1, 0), pt(1, 1)] }, 'add');
    expect(added).toEqual({ spawns: [], points: [pt(1, 0), pt(1, 1)], routes: [1] });
    expect(combine(added, { points: [pt(1, 0)] }, 'remove')).toEqual({ spawns: [], points: [pt(1, 1)], routes: [1] });
  });

  it('a plain pick of nothing clears everything, routes too; Shift or Ctrl with nothing changes nothing', () => {
    const before: Selection = { spawns: [npc(1)], points: [pt(1, 0)], routes: [1] };
    expect(combine(before, { spawns: [] }, 'replace')).toEqual(EMPTY_SELECTION);
    expect(combine(before, { points: [] }, 'replace')).toEqual(EMPTY_SELECTION);
    expect(combine(before, { spawns: [] }, 'add')).toEqual(before);
    expect(combine(before, { points: [] }, 'remove')).toEqual(before);
  });

  it('is empty only with nothing picked and no route active', () => {
    expect(isEmpty(EMPTY_SELECTION)).toBe(true);
    expect(isEmpty({ spawns: [], points: [], routes: [1] })).toBe(false);
  });
});

describe('picked points after their route changes', () => {
  it('a delete drops the deleted points and moves later ones down', () => {
    const s: Selection = { spawns: [], points: [pt(1, 0), pt(1, 2), pt(1, 5), pt(2, 2)], routes: [1, 2] };
    expect(afterRouteChange(s, 1, { kind: 'delete', indexes: [2, 1] }).points).toEqual([pt(1, 0), pt(1, 3), pt(2, 2)]);
  });

  it('an insert moves the points at and after it up', () => {
    const s: Selection = { spawns: [], points: [pt(1, 0), pt(1, 2), pt(2, 2)], routes: [1, 2] };
    expect(afterRouteChange(s, 1, { kind: 'insert', index: 2 }).points).toEqual([pt(1, 0), pt(1, 3), pt(2, 2)]);
  });
});
