// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

const gizmos = vi.hoisted(() => [] as any[]);
vi.mock('../../src/renderer/world3d/scene/edit/Gizmo', async (importActual) => {
  const actual = await importActual<typeof import('../../src/renderer/world3d/scene/edit/Gizmo')>();
  class FakeGizmo {
    events: any;
    hovered = false;
    dragging = false;
    at: THREE.Vector3 | null = null;
    turns: string | null = null;
    mode = 'move';
    constructor(_camera: unknown, _dom: unknown, _scene: unknown, _ground: unknown, events: any) {
      this.events = events;
      gizmos.push(this);
    }
    get attached() {
      return this.at !== null;
    }
    attach(at: THREE.Vector3, _q: THREE.Quaternion, turns: string) {
      this.at = at.clone();
      this.turns = turns;
    }
    detach() {
      this.at = null;
      this.turns = null;
    }
    setMode(mode: string) {
      this.mode = mode;
    }
    groundAt() {
      return 0;
    }
    dispose() {}
  }
  return { ...actual, Gizmo: FakeGizmo };
});

import { Editor, PICK_POINT_FIRST, TOO_SHORT, type EditingWorld } from '../../src/renderer/world3d/editing';
import type { EditPoint, SpawnEdit } from '../../src/renderer/world3d/edits';
import { EMPTY_SELECTION, type Selection } from '../../src/renderer/world3d/scene/edit/selection';
import type { Falloff } from '../../src/renderer/world3d/scene/edit/falloff';

type Route = { pathId: number; own: boolean; entry: number; points: EditPoint[] };
const sel = (s: Partial<Selection>): Selection => ({ ...EMPTY_SELECTION, ...s });
const line = (pathId: number, xs: number[], y = 0): Route => ({ pathId, own: false, entry: 1, points: xs.map((x) => ({ x, y, z: 0 })) });
const key = (code: string) => new KeyboardEvent('keydown', { code });

function setup(opts: { routes?: Record<number, Route>; floor?: number | null; answers?: Record<number, boolean | Promise<boolean>> } = {}) {
  const spawns = new Map<string, THREE.Object3D>();
  const npc = (guid: number, x: number, y: number) => {
    const o = new THREE.Object3D();
    o.position.set(x, y, 0);
    o.userData.spawn = { kind: 'creature', guid, entry: 100 + guid, own: false };
    spawns.set(`creature:${guid}`, o);
    return o;
  };
  const drop = (guid: number) => spawns.delete(`creature:${guid}`);
  const routes = new Map(Object.entries(opts.routes ?? {}).map(([g, r]) => [Number(g), r]));
  const pending: [number, EditPoint[]][] = [];
  const previews: [number, EditPoint[]][] = [];
  const world: EditingWorld = {
    camera: new THREE.PerspectiveCamera(),
    dom: document.createElement('canvas'),
    scene: new THREE.Scene(),
    ground: () => [],
    pickGround: () => null,
    rayAt: () => new THREE.Ray(),
    findSpawn: (kind, guid) => spawns.get(`${kind}:${guid}`) ?? null,
    spawnRoute: (guid) => routes.get(guid) ?? null,
    pickRoutePoint: () => null,
    setPendingRoute: (guid, points) => {
      pending.push([guid, points]);
      const route = routes.get(guid);
      if (route) routes.set(guid, { ...route, points });
    },
    previewRoute: (guid, points) => previews.push([guid, points]),
  };
  const edits: SpawnEdit[] = [];
  const notices: (string | null)[] = [];
  const asked: number[] = [];
  const selections: Selection[] = [];
  const falloffs: Falloff[] = [];
  const floorZ = vi.fn(async () => (opts.floor === undefined ? 1 : opts.floor));
  const editor = new Editor(world, {
    onEdit: (e) => edits.push(e),
    floorZ,
    onNotice: (m) => notices.push(m),
    onSelection: (s) => selections.push(s),
    onFalloff: (f) => falloffs.push(f),
    beforeRouteEdit: (_spawn, pathId) => {
      asked.push(pathId);
      return Promise.resolve(opts.answers?.[pathId] ?? true);
    },
  });
  const gizmo = gizmos.at(-1);
  const change = (delta: [number, number, number] = [0, 0, 0], angle = 0) => ({ delta: new THREE.Vector3(...delta), angle, quaternion: new THREE.Quaternion(), axis: null });
  const drag = async (delta?: [number, number, number], angle?: number, lifted = false) => {
    editor.update();
    gizmo.events.started();
    gizmo.events.moved(change(delta, angle));
    await gizmo.events.ended(lifted);
  };
  return { editor, world, edits, notices, asked, selections, falloffs, floorZ, gizmo, npc, drop, drag, change, pending, previews };
}

const placed = (edits: SpawnEdit[]) => edits.map((e) => (e.kind === 'place' ? [e.spawn.guid, e.to.x, e.to.y, e.to.z] : null));

describe('moving and turning a selection in the 3D view', () => {
  it('moves every selected spawn by the drag, drops each on the server floor, and undoes them as one step', async () => {
    const t = setup({ floor: 1 });
    t.npc(1, 0, 0);
    t.npc(2, 10, 0);
    t.editor.setSelection(sel({ spawns: [{ kind: 'creature', guid: 1 }, { kind: 'creature', guid: 2 }] }));
    t.editor.update();
    expect(t.gizmo.at.toArray()).toEqual([5, 0, 0]);
    expect(t.gizmo.turns).toBe('z');
    await t.drag([0, 4, 0]);
    expect(t.floorZ).toHaveBeenCalledTimes(2);
    expect(placed(t.edits)).toEqual([[1, 0, 4, 1], [2, 10, 4, 1]]);
    t.editor.undo();
    expect(placed(t.edits.slice(2))).toEqual([[1, 0, 0, 0], [2, 10, 0, 0]]);
  });

  it('moves picked route points as a block, leaving the rest of the route where it was', async () => {
    const t = setup({ routes: { 7: line(50, [0, 10, 20, 30]) }, floor: 0 });
    t.npc(7, -5, 0);
    t.editor.setSelection(sel({ points: [{ guid: 7, index: 1 }, { guid: 7, index: 2 }], routes: [7] }));
    await t.drag([0, 4, 0]);
    expect(t.edits).toHaveLength(1);
    expect(t.edits[0]).toMatchObject({ kind: 'route', pathId: 50, spawn: { guid: 7 } });
    expect((t.edits[0] as any).points.map((p: EditPoint) => [p.x, p.y])).toEqual([[0, 0], [10, 4], [20, 4], [30, 0]]);
  });

  it('with falloff on, the rest of the route follows by a share that falls with distance', async () => {
    const t = setup({ routes: { 7: line(50, [0, 5, 10, 20]) }, floor: 0 });
    t.npc(7, -5, 0);
    t.editor.setFalloff({ on: true, radius: 10 });
    t.editor.setSelection(sel({ points: [{ guid: 7, index: 0 }], routes: [7] }));
    await t.drag([0, 4, 0]);
    expect((t.edits[0] as any).points.map((p: EditPoint) => p.y)).toEqual([4, 2, 0, 0]);
  });

  it('the wheel during a falloff drag grows the radius and the curve follows at once; otherwise the wheel is the camera\'s', () => {
    const t = setup({ routes: { 7: line(50, [0, 5, 10, 20]) }, floor: 0 });
    t.npc(7, -5, 0);
    expect(t.editor.wheel(-100)).toBe(false);
    t.editor.setFalloff({ on: true, radius: 10 });
    t.editor.setSelection(sel({ points: [{ guid: 7, index: 0 }], routes: [7] }));
    t.editor.update();
    t.gizmo.events.started();
    t.gizmo.events.moved(t.change([0, 4, 0]));
    expect(t.previews.at(-1)![1][2]!.y).toBe(0);
    expect(t.editor.wheel(-100)).toBe(true);
    expect(t.editor.falloff.radius).toBeCloseTo(11, 9);
    expect(t.previews.at(-1)![1][2]!.y).toBeGreaterThan(0);
    expect(t.falloffs.at(-1)!.radius).toBeCloseTo(11, 9);
  });

  it('R turns the group round its centre: positions swing and facings turn, with no floor drop', async () => {
    const t = setup();
    t.npc(1, 0, 0);
    t.npc(2, 10, 0);
    t.editor.setSelection(sel({ spawns: [{ kind: 'creature', guid: 1 }, { kind: 'creature', guid: 2 }] }));
    t.editor.setMode('rotate');
    await t.drag(undefined, Math.PI / 2);
    expect(t.floorZ).not.toHaveBeenCalled();
    const to = t.edits.map((e) => (e.kind === 'place' ? [e.to.x, e.to.y, e.to.orientation] : []));
    expect(to[0]![0]).toBeCloseTo(5, 6);
    expect(to[0]![1]).toBeCloseTo(-5, 6);
    expect(to[0]![2]).toBeCloseTo(Math.PI / 2, 6);
    expect(to[1]![0]).toBeCloseTo(5, 6);
    expect(to[1]![1]).toBeCloseTo(5, 6);
    expect(to[1]![2]).toBeCloseTo(Math.PI / 2, 6);
  });

  it('a drag released where it started makes no edit and no undo step', async () => {
    const t = setup();
    t.npc(1, 0, 0);
    t.editor.setSelection(sel({ spawns: [{ kind: 'creature', guid: 1 }] }));
    await t.drag();
    expect(t.edits).toEqual([]);
    expect(t.floorZ).not.toHaveBeenCalled();
    t.editor.undo();
    expect(t.edits).toEqual([]);
  });

  it('a spawn redrawn during a drag is followed by guid, and one gone by the end is left out', async () => {
    const t = setup({ floor: 0 });
    t.npc(1, 0, 0);
    t.npc(2, 10, 0);
    t.editor.setSelection(sel({ spawns: [{ kind: 'creature', guid: 1 }, { kind: 'creature', guid: 2 }] }));
    t.editor.update();
    t.gizmo.events.started();
    // The area was redrawn: a new object stands for spawn 1
    const redrawn = t.npc(1, 0, 0);
    t.gizmo.events.moved(t.change([0, 4, 0]));
    expect(redrawn.position.y).toBe(4);
    t.drop(2);
    await t.gizmo.events.ended(false);
    expect(placed(t.edits)).toEqual([[1, 0, 4, 0]]);
  });
});

describe('route edits on several routes at once', () => {
  it('a route answered no goes back, and the rest of the gesture stands as one undo step', async () => {
    const a = line(50, [0, 10]);
    const b = line(60, [0, 10], 20);
    const t = setup({ routes: { 7: a, 8: b }, floor: 0, answers: { 60: false } });
    t.npc(7, -5, 0);
    t.npc(8, -5, 20);
    t.editor.setSelection(sel({ points: [{ guid: 7, index: 0 }, { guid: 8, index: 0 }], routes: [7, 8] }));
    await t.drag([1, 0, 0]);
    expect(t.edits.map((e) => e.kind === 'route' && e.pathId)).toEqual([50]);
    expect(t.pending).toContainEqual([8, b.points]);
    t.editor.undo();
    expect(t.edits.slice(1).map((e) => e.kind === 'route' && e.pathId)).toEqual([50]);
  });

  it('asks about one shared route at a time', async () => {
    let release!: (yes: boolean) => void;
    const first = new Promise<boolean>((resolve) => (release = resolve));
    const t = setup({ routes: { 7: line(50, [0, 10]), 8: line(60, [0, 10], 20) }, floor: 0, answers: { 50: first, 60: true } });
    t.npc(7, -5, 0);
    t.npc(8, -5, 20);
    t.editor.setSelection(sel({ points: [{ guid: 7, index: 0 }, { guid: 8, index: 0 }], routes: [7, 8] }));
    const done = t.drag([1, 0, 0]);
    await vi.waitFor(() => expect(t.asked).toEqual([50]));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(t.asked).toEqual([50]);
    release(true);
    await done;
    expect(t.asked).toEqual([50, 60]);
    expect(t.edits.map((e) => e.kind === 'route' && e.pathId)).toEqual([50, 60]);
  });

  it('Delete removes every picked point, leaving a route that would fall below two as it was', async () => {
    const t = setup({ routes: { 7: line(50, [0, 10, 20]), 8: line(60, [0, 10, 20, 30], 20) } });
    t.npc(7, -5, 0);
    t.npc(8, -5, 20);
    t.editor.setSelection(sel({ points: [{ guid: 7, index: 0 }, { guid: 7, index: 1 }, { guid: 8, index: 2 }], routes: [7, 8] }));
    expect(t.editor.keyDown(key('Delete'))).toBe(true);
    await vi.waitFor(() => expect(t.edits).toHaveLength(1));
    expect(t.edits[0]).toMatchObject({ kind: 'route', pathId: 60 });
    expect((t.edits[0] as any).points.map((p: EditPoint) => p.x)).toEqual([0, 10, 30]);
    expect(t.notices).toContain(TOO_SHORT);
    expect(t.editor.selection.points).toEqual([{ guid: 7, index: 0 }, { guid: 7, index: 1 }]);
    expect(t.selections.at(-1)!.points).toEqual([{ guid: 7, index: 0 }, { guid: 7, index: 1 }]);
  });

  it('a click on a leg of an active route puts a new point there and picks it', async () => {
    const t = setup({ routes: { 7: { pathId: 50, own: false, entry: 1, points: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 10, y: 10, z: 0 }] } } });
    t.npc(7, -5, 0);
    t.world.pickGround = () => new THREE.Vector3(5, 1, 0);
    t.editor.setSelection(sel({ routes: [7] }));
    expect(t.editor.insertPoint(0, 0)).toBe(true);
    await vi.waitFor(() => expect(t.edits).toHaveLength(1));
    expect((t.edits[0] as any).points.map((p: EditPoint) => [p.x, p.y])).toEqual([[0, 0], [5, 1], [10, 0], [10, 10]]);
    expect(t.editor.selection.points).toEqual([{ guid: 7, index: 1 }]);
  });

  it('with several active routes and no leg near, a new point goes after the last picked one; with none picked, nothing is added', async () => {
    const t = setup({ routes: { 7: line(50, [0, 10]), 8: line(60, [0, 10, 20], 20) } });
    t.npc(7, -5, 0);
    t.npc(8, -5, 20);
    t.world.pickGround = () => new THREE.Vector3(50, 50, 0);
    t.editor.setSelection(sel({ routes: [7, 8] }));
    expect(t.editor.insertPoint(0, 0)).toBe(true);
    expect(t.notices).toContain(PICK_POINT_FIRST);
    expect(t.edits).toEqual([]);
    t.editor.setSelection(sel({ points: [{ guid: 7, index: 0 }, { guid: 8, index: 1 }], routes: [7, 8] }));
    t.editor.insertPoint(0, 0);
    await vi.waitFor(() => expect(t.edits).toHaveLength(1));
    expect(t.edits[0]).toMatchObject({ pathId: 60 });
    expect((t.edits[0] as any).points.map((p: EditPoint) => p.x)).toEqual([0, 10, 50, 20]);
  });

  it('O switches falloff and [ ] change its radius, each told to the host', () => {
    const t = setup();
    expect(t.editor.keyDown(key('KeyO'))).toBe(true);
    expect(t.falloffs.at(-1)).toEqual({ on: true, radius: 10 });
    t.editor.keyDown(key('BracketRight'));
    expect(t.falloffs.at(-1)!.radius).toBeCloseTo(11, 9);
    t.editor.keyDown(key('BracketLeft'));
    expect(t.falloffs.at(-1)!.radius).toBeCloseTo(9.9, 9);
    t.editor.keyDown(key('KeyO'));
    expect(t.falloffs.at(-1)!.on).toBe(false);
  });
});

describe('where the picked points are drawn', () => {
  it('as the route has them, following a drag', () => {
    const t = setup({ routes: { 7: line(50, [0, 10]) } });
    t.npc(7, -5, 0);
    t.editor.setSelection(sel({ points: [{ guid: 7, index: 1 }], routes: [7] }));
    expect(t.editor.pointPositions()).toEqual([{ x: 10, y: 0, z: 0 }]);
    t.editor.update();
    t.gizmo.events.started();
    t.gizmo.events.moved(t.change([0, 3, 0]));
    expect(t.editor.pointPositions()).toEqual([{ x: 10, y: 3, z: 0 }]);
  });
});
