// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { WorldLayer } from '../../src/core/world/layer';
import SpawnManager from '../../src/renderer/world3d/scene/spawn/SpawnManager';

const creature = (guid: number, displayId: number, extra: object = {}) => ({
  guid, entry: 1, name: 'n', map: 0, x: 0, y: 0, z: 0, orientation: 0, displayId, scale: 1, wander: 0, path: null, equipment: [0, 0, 0] as [number, number, number], own: false, event: null, events: [], removedBy: [], pathId: 0, preset: null, group: null, respawnSecs: 300, ...extra,
});
const object = (guid: number, displayId: number, extra: object = {}) => ({
  guid, entry: 2, name: 'o', map: 0, x: 0, y: 0, z: 0, rotation: [0, 0, 0, 1] as [number, number, number, number], displayId, scale: 1, objectType: 5, own: false, event: null, events: [], removedBy: [], group: null, respawnSecs: 300, ...extra,
});
const box = { minX: 0, maxX: 1, minY: 0, maxY: 1 };

const manager = (spawns: any, overrides: Partial<ConstructorParameters<typeof SpawnManager>[0]> = {}) =>
  new SpawnManager({
    resolver: {
      creature: async (id: number) => (id === 1 ? { kind: 'model', path: 'a.m2', textures: {}, geosets: null, scale: 1 } : null),
      object: async (id: number) => (id === 2 ? { kind: 'building', path: 'b.wmo', scale: 1 } : null),
    } as any,
    createModel: async () => new THREE.Object3D(),
    createBuilding: async () => new THREE.Group(),
    source: async () => spawns,
    ...overrides,
  });

describe('the spawn layer', () => {
  it('draws what it can and a marker for what it cannot, tagging each with its spawn', async () => {
    const m = manager({ creatures: [creature(1, 1), creature(2, 0)], objects: [object(3, 2), object(4, 77)], capped: { creatures: false, objects: false } });
    const group = (await m.loadArea(1, 0, box))!;
    const creatures = group.getObjectByName('creatures')!.children;
    expect(creatures.map((c) => [c.userData.spawn.guid, c.name])).toEqual([[1, ''], [2, 'marker']]);
    const objects = group.getObjectByName('objects')!.children;
    expect(objects.map((o) => [o.userData.spawn.guid, o.name])).toEqual([[3, ''], [4, 'marker']]);
  });

  it('draws a marker, and the rest, when making one model fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let n = 0;
    const m = manager({ creatures: [creature(1, 1), creature(2, 1)], objects: [], capped: { creatures: false, objects: false } }, {
      createModel: async () => { if (n++ === 0) throw new Error('bad model'); return new THREE.Object3D(); },
    });
    const group = (await m.loadArea(1, 0, box))!;
    expect(group.getObjectByName('creatures')!.children.map((c) => c.name)).toEqual(['marker', '']);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^3D view: .*bad model/));
    warn.mockRestore();
  });

  it('keeps an area empty, with the reason, when the database cannot give spawns', async () => {
    const m = manager({ error: 'not connected' });
    const group = await m.loadArea(1, 0, box);
    expect(group).toBeNull();
    expect(m.status.error).toBe('not connected');
  });

  it('says when a kind was capped', async () => {
    const m = manager({ creatures: [], objects: [], capped: { creatures: true, objects: false } });
    await m.loadArea(1, 0, box);
    expect(m.status.capped).toEqual({ creatures: true, objects: false });
  });

  it('drops an area that was removed while its spawns were on their way', async () => {
    let release!: (v: unknown) => void;
    const m = manager(null, { source: () => new Promise((r) => (release = r)) as any });
    const loading = m.loadArea(1, 0, box);
    m.removeArea(1);
    release({ creatures: [creature(1, 1)], objects: [], capped: { creatures: false, objects: false } });
    expect(await loading).toBeNull();
  });

  it('hides and shows each kind without unloading it', async () => {
    const m = manager({ creatures: [creature(1, 1)], objects: [object(3, 2)], capped: { creatures: false, objects: false } });
    const group = (await m.loadArea(1, 0, box))!;
    m.setVisibility({ creatures: false, objects: true, paths: false, events: 'none' });
    expect(group.getObjectByName('creatures')!.visible).toBe(false);
    expect(group.getObjectByName('objects')!.visible).toBe(true);
    expect(group.getObjectByName('paths')!.visible).toBe(false);
    expect(group.getObjectByName('creatures')!.children).toHaveLength(1);
  });
});

describe('how far spawns are drawn', () => {
  it('hides spawns beyond the draw distance from the camera, and shows them again within it', async () => {
    const m = manager({ creatures: [creature(1, 1, { x: 50 }), creature(2, 1, { x: 1200 })], objects: [object(3, 2)], capped: { creatures: false, objects: false } });
    const group = (await m.loadArea(1, 0, box))!;
    const [near, far] = group.getObjectByName('creatures')!.children;
    m.cull(new THREE.Vector3(0, 0, 0));
    expect([near!.visible, far!.visible]).toEqual([true, false]);
    m.cull(new THREE.Vector3(1190, 0, 0));
    expect([near!.visible, far!.visible]).toEqual([false, true]);
  });

  it('draws an NPC as far off as its area is loaded while its route is worked on, and offers it to a box', async () => {
    const m = manager({ creatures: [creature(1, 1, { x: 50 }), creature(2, 1, { x: 1200, path: [{ x: 1210, y: 0, z: 0 }] })], objects: [], capped: { creatures: false, objects: false } });
    const group = (await m.loadArea(1, 0, box))!;
    const [, far] = group.getObjectByName('creatures')!.children;
    m.setActiveRoutes([2]);
    m.cull(new THREE.Vector3(0, 0, 0));
    expect(far!.visible).toBe(true);
    expect(m.candidates(new THREE.Vector3(0, 0, 0)).spawns.map((s) => s.guid)).toEqual([1, 2]);
    m.setActiveRoutes([]);
    m.cull(new THREE.Vector3(0, 0, 0));
    expect(far!.visible).toBe(false);
  });

  it('hides a model the camera does not look at, so it is neither drawn nor animated, but still finds it for edits', async () => {
    // A model with the world bounding sphere the real ones keep
    const sphered = async () => {
      const model: any = new THREE.Object3D();
      model.boundingSphereWorld = new THREE.Sphere(new THREE.Vector3(), 1);
      model.updateMatrixWorld = function (force?: boolean) { THREE.Object3D.prototype.updateMatrixWorld.call(this, force); this.boundingSphereWorld.center.copy(this.position); };
      return model;
    };
    const m = manager({ creatures: [creature(1, 1, { x: 50 }), creature(2, 1, { x: -50 })], objects: [], capped: { creatures: false, objects: false } }, { createModel: sphered });
    const group = (await m.loadArea(1, 0, box))!;
    group.updateMatrixWorld(true);
    // Looking along +X from the origin: the NPC at x 50 is ahead, the one at x -50 behind
    const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 1000);
    camera.up.set(0, 0, 1);
    camera.lookAt(1, 0, 0);
    camera.updateMatrixWorld();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    m.cull(new THREE.Vector3(0, 0, 0), frustum);
    const [ahead, behind] = group.getObjectByName('creatures')!.children;
    expect([ahead!.visible, behind!.visible]).toEqual([true, false]);
    expect(m.find('creature', 2)).toBe(behind);
  });

  it('leaves off what an NPC wears or holds when it is far off or out of view, which also stops it animating', async () => {
    const worn: any[] = [];
    const dressed = async () => {
      const model: any = new THREE.Object3D();
      const point = new THREE.Object3D();
      point.name = 'attachment:11';
      const helmet: any = new THREE.Object3D();
      helmet.hide = vi.fn(() => { helmet.visible = false; });
      helmet.show = vi.fn(() => { helmet.visible = true; });
      point.add(helmet);
      model.add(point);
      worn.push(helmet);
      return model;
    };
    const m = manager({ creatures: [creature(1, 1, { x: 50 })], objects: [], capped: { creatures: false, objects: false } }, { createModel: dressed });
    await m.loadArea(1, 0, box);
    const [helmet] = worn;
    m.cull(new THREE.Vector3(0, 0, 0));
    expect(helmet.visible).toBe(true);
    m.cull(new THREE.Vector3(-300, 0, 0));
    expect(helmet.visible).toBe(false);
    expect(helmet.hide).toHaveBeenCalled();
    m.cull(new THREE.Vector3(0, 0, 0));
    expect(helmet.visible).toBe(true);
    // Beyond draw distance the NPC is hidden, and so is what it wears
    m.cull(new THREE.Vector3(-1000, 0, 0));
    expect(helmet.visible).toBe(false);
  });

  it('draws spawns further than the game does, for an editor zoomed out over a route', async () => {
    const m = manager({ creatures: [creature(1, 1, { x: 480 })], objects: [], capped: { creatures: false, objects: false } });
    const group = (await m.loadArea(1, 0, box))!;
    m.cull(new THREE.Vector3(0, 0, 0));
    expect(group.getObjectByName('creatures')!.children[0]!.visible).toBe(true);
  });
});

describe('standing NPCs on the drawn ground', () => {
  const spawns = (creatures: object[], objects: object[] = []) => ({ creatures, objects, capped: { creatures: false, objects: false } });
  const eye = new THREE.Vector3(0, 0, 0);

  it('lifts an NPC that stands below the ground onto it, and leaves its own Z alone', async () => {
    const calls: number[][] = [];
    const m = manager(spawns([creature(1, 1, { z: 10 })]), { groundBelow: (x, y, from, distance) => (calls.push([x, y, from, distance]), 10.4) });
    const group = (await m.loadArea(1, 0, box))!;
    m.cull(eye);
    const [npc] = group.getObjectByName('creatures')!.children;
    expect(npc!.position.z).toBeCloseTo(10.4);
    expect(npc!.userData.lift).toBeCloseTo(0.4);
    expect(npc!.userData.spawn.position.z).toBe(10);
    // Looked for from a yard and a half above its Z, no further down than that
    expect(calls).toEqual([[0, 0, 11.5, 1.5]]);
    // Once is enough
    m.cull(eye);
    expect(calls).toHaveLength(1);
  });

  it('leaves an NPC alone that stands on or above the ground, or whose ground is further off than it can be lifted', async () => {
    const above = manager(spawns([creature(1, 1, { z: 10 })]), { groundBelow: () => 9.9 });
    const aboveGroup = (await above.loadArea(1, 0, box))!;
    above.cull(eye);
    expect(aboveGroup.getObjectByName('creatures')!.children[0]!.position.z).toBe(10);
    // A ground reported higher than the probe could have reached is still only lifted as far as the limit
    const far = manager(spawns([creature(1, 1, { z: 10 })]), { groundBelow: () => 14 });
    const farGroup = (await far.loadArea(1, 0, box))!;
    far.cull(eye);
    expect(farGroup.getObjectByName('creatures')!.children[0]!.position.z).toBeCloseTo(11.5);
  });

  it('asks again a few times when the terrain is not there yet, then gives up and leaves the NPC', async () => {
    let clock = 0;
    let ground: number | null = null;
    const asked = vi.fn(() => ground);
    const m = manager(spawns([creature(1, 1, { z: 10 })]), { groundBelow: asked, now: () => clock });
    const group = (await m.loadArea(1, 0, box))!;
    const npc = () => group.getObjectByName('creatures')!.children[0]!;
    m.cull(eye);
    // Not again before the wait is up
    m.cull(eye);
    expect(asked).toHaveBeenCalledTimes(1);
    clock = 2500;
    ground = 10.3;
    m.cull(eye);
    expect(npc().position.z).toBeCloseTo(10.3);

    // An NPC with nothing under it (flying) is asked about only a few times
    const nothing = vi.fn(() => null);
    const flying = manager(spawns([creature(2, 1, { z: 10 })]), { groundBelow: nothing, now: () => clock });
    await flying.loadArea(1, 0, box);
    for (let i = 0; i < 10; i += 1) {
      clock += 2500;
      flying.cull(eye);
    }
    expect(nothing).toHaveBeenCalledTimes(4);
  });

  it('does not lift objects, markers, or NPCs out of range', async () => {
    const asked = vi.fn(() => 12);
    const m = manager(spawns([creature(1, 0, { z: 10 }), creature(2, 1, { z: 10, x: 1200 })], [object(3, 2, { z: 10 })]), { groundBelow: asked });
    const group = (await m.loadArea(1, 0, box))!;
    m.cull(eye);
    expect(asked).not.toHaveBeenCalled();
    expect(group.getObjectByName('objects')!.children[0]!.position.z).toBe(10);
  });

  it('draws a spawn at the Z the layer gives it, lifted from there, when it was moved', async () => {
    const m = manager(spawns([creature(1, 1, { z: 10 })]), { groundBelow: (_x, _y, from) => from - 1.5 + 0.2 });
    const group = (await m.loadArea(1, 0, box))!;
    await m.setWorldLayer({ spawns: [{ kind: 'creature', guid: 1, entry: 1, name: 'n', map: 0, original: { x: 0, y: 0, z: 10, orientation: 0, rotation: null }, current: { x: 0, y: 0, z: 20, orientation: 0, rotation: null } }], routes: [], added: [] });
    m.cull(eye);
    expect(group.getObjectByName('creatures')!.children[0]!.position.z).toBeCloseTo(20.2);
  });
});

describe('which routes are drawn', () => {
  it('draws only the routes and wander circles of the active NPCs, however far away they are', async () => {
    const m = manager({
      creatures: [creature(1, 1, { x: 400, wander: 5 }), creature(2, 1, { x: 400, path: [{ x: 410, y: 0, z: 0 }] }), creature(3, 1, { x: 20, wander: 5 })],
      objects: [], capped: { creatures: false, objects: false },
    });
    const group = (await m.loadArea(1, 0, box))!;
    const shown = () => group.getObjectByName('paths')!.children.map((p) => p.visible);
    m.cull(new THREE.Vector3(0, 0, 0));
    expect(shown()).toEqual([false, false, false]);
    m.setActiveRoutes([2]);
    m.cull(new THREE.Vector3(0, 0, 0));
    expect(shown()).toEqual([false, true, false]);
    m.setActiveRoutes([1, 2]);
    m.cull(new THREE.Vector3(0, 0, 0));
    expect(shown()).toEqual([true, true, false]);
    m.setActiveRoutes([]);
    m.cull(new THREE.Vector3(0, 0, 0));
    expect(shown()).toEqual([false, false, false]);
  });

  it('marks the picked points of a drawn route, and unmarks them', async () => {
    const m = manager({ creatures: [creature(2, 0, { path: [{ x: 10, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }] })], objects: [], capped: { creatures: false, objects: false } });
    const group = (await m.loadArea(1, 0, box))!;
    const scales = () => group.getObjectByName('route')!.children.filter((c) => typeof c.userData.point === 'number').map((b) => b.scale.x);
    m.setActiveRoutes([2]);
    m.markPoints([{ guid: 2, index: 1 }]);
    m.cull(new THREE.Vector3(0, 0, 0));
    expect(scales()[0]).toBe(1);
    expect(scales()[1]).toBeGreaterThan(1);
    m.markPoints([]);
    m.cull(new THREE.Vector3(0, 0, 0));
    expect(scales()).toEqual([1, 1]);
  });

  it('offers a box the points of drawn routes and the shown spawns within draw distance', async () => {
    const m = manager({
      creatures: [creature(2, 0, { path: [{ x: 10, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }] }), creature(5, 0, { x: 1200 })],
      objects: [object(3, 0, { x: 4 })], capped: { creatures: false, objects: false },
    });
    await m.loadArea(1, 0, box);
    m.setActiveRoutes([2]);
    m.cull(new THREE.Vector3(0, 0, 0));
    const c = m.candidates(new THREE.Vector3(0, 0, 0));
    expect(c.points.map((p) => [p.guid, p.index, p.at.x])).toEqual([[2, 0, 10], [2, 1, 20]]);
    expect(c.spawns.map((s) => [s.kind, s.guid])).toEqual([['creature', 2], ['object', 3]]);
    m.setVisibility({ creatures: true, objects: false, paths: true, events: 'none' });
    expect(m.candidates(new THREE.Vector3(0, 0, 0)).spawns.map((s) => s.guid)).toEqual([2]);
  });

  it('moves a drawn route to dragged points without drawing its area again', async () => {
    const m = manager({ creatures: [creature(2, 0, { path: [{ x: 10, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }] })], objects: [], capped: { creatures: false, objects: false } });
    const group = (await m.loadArea(1, 0, box))!;
    const route = group.getObjectByName('route')!;
    m.previewRoute(2, [{ x: 10, y: 5, z: 0 }, { x: 20, y: 0, z: 0 }]);
    expect(group.getObjectByName('route')).toBe(route);
    expect(route.children.find((c) => c.userData.point === 0)!.position.toArray()).toEqual([10, 5, 0]);
  });

  it('gives a drawn spawn as a click picks it, by guid', async () => {
    const m = manager({ creatures: [creature(2, 0, { x: 3 })], objects: [], capped: { creatures: false, objects: false } });
    await m.loadArea(1, 0, box);
    expect(m.picked('creature', 2)).toMatchObject({ kind: 'creature', guid: 2, position: { x: 3, y: 0, z: 0 } });
    expect(m.picked('creature', 9)).toBeNull();
  });
});

describe('what the console is told', () => {
  it('names a spawn whose display the client does not know, once per display', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = manager({ creatures: [creature(1, 77), creature(2, 77), creature(3, 0)], objects: [object(4, 88)], capped: { creatures: false, objects: false } });
    await m.loadArea(1, 0, box);
    const lines = warn.mock.calls.map((c) => String(c[0]));
    expect(lines.filter((l) => /creature 1 \(display 77\)/.test(l))).toHaveLength(1);
    expect(lines.some((l) => /creature 2 \(display 77\)/.test(l))).toBe(false);
    expect(lines.some((l) => /object 4 \(display 88\)/.test(l))).toBe(true);
    // No display at all (0) is a marker by design, not news
    expect(lines.some((l) => /creature 3/.test(l))).toBe(false);
    warn.mockRestore();
  });
});

it('draws the open quest\'s own spawns in their area, in place of the database row with the same guid', async () => {
  const m = manager({ creatures: [creature(5, 1), creature(6, 1)], objects: [], capped: { creatures: false, objects: false } });
  m.setOwnSpawns({ creatures: [creature(6, 1, { own: true, x: 0.5, y: 0.5 }), creature(7, 1, { own: true, x: 50, y: 50 })], objects: [], capped: { creatures: false, objects: false } });
  const group = (await m.loadArea(1, 0, box))!;
  const drawn = group.getObjectByName('creatures')!.children.map((c) => [c.userData.spawn.guid, c.userData.spawn.own]);
  // 7 is outside this area's box (0..1); 6 is drawn once, as the project's
  expect(drawn).toEqual([[5, false], [6, true]]);
});

// A spawn placed while its area's models were still being made was left out of it until another redraw,
// so Draw patrol on it found nothing
it('draws an own spawn placed while its area was still being drawn', async () => {
  let made!: () => void;
  const slow = new Promise<void>((r) => (made = r));
  const m = manager({ creatures: [creature(5, 1)], objects: [], capped: { creatures: false, objects: false } }, {
    createModel: async () => { await slow; return new THREE.Object3D(); },
  });
  const loading = m.loadArea(1, 0, box);
  await new Promise((r) => setTimeout(r, 0));
  await m.setOwnSpawns({ creatures: [creature(6, 1, { own: true, x: 0.5, y: 0.5 })], objects: [], capped: { creatures: false, objects: false } });
  made();
  const group = (await loading)!;
  expect(group.getObjectByName('creatures')!.children.map((c) => c.userData.spawn.guid)).toEqual([5, 6]);
  expect(m.info('creature', 6)).toMatchObject({ guid: 6, own: true });
});

describe('the final review\'s findings', () => {
  const disposable = () => {
    const model = new THREE.Object3D() as THREE.Object3D & { dispose: ReturnType<typeof vi.fn> };
    model.dispose = vi.fn();
    return model;
  };

  it('frees the models of an area it drops, and of a spawn a redraw draws again or takes out', async () => {
    const made: ReturnType<typeof disposable>[] = [];
    const m = manager({ creatures: [creature(1, 1), creature(2, 1), creature(3, 1)], objects: [], capped: { creatures: false, objects: false } }, {
      createModel: async () => { const d = disposable(); made.push(d); return d; },
    });
    await m.loadArea(1, 0, box);
    // A redraw that changes nothing keeps every model
    await m.setOwnSpawns({ creatures: [], objects: [], capped: { creatures: false, objects: false } });
    expect(made).toHaveLength(3);
    expect(made.every((d) => d.dispose.mock.calls.length === 0)).toBe(true);
    // The quest's own NPC 1, larger, in place of the database's: drawn again, the old model freed
    await m.setOwnSpawns({ creatures: [{ ...creature(1, 1), own: true, scale: 3 }], objects: [], capped: { creatures: false, objects: false } });
    expect(made).toHaveLength(4);
    expect(made.map((d) => d.dispose.mock.calls.length)).toEqual([1, 0, 0, 0]);
    m.removeArea(1);
    expect(made.slice(1).every((d) => d.dispose.mock.calls.length === 1)).toBe(true);
  });

  it('keeps an area loading while its newer request is out, whatever the stale one does', async () => {
    const releases: ((v: unknown) => void)[] = [];
    const m = manager(null, { source: () => new Promise((r) => releases.push(r)) as any });
    const first = m.loadArea(1, 0, box);
    m.removeArea(1);
    const second = m.loadArea(1, 0, box);
    releases[0]!({ creatures: [creature(1, 1)], objects: [], capped: { creatures: false, objects: false } });
    expect(await first).toBeNull();
    expect(m.canLoad(1)).toBe(false);
    releases[1]!({ creatures: [creature(1, 1)], objects: [], capped: { creatures: false, objects: false } });
    expect(await second).not.toBeNull();
    expect(m.canLoad(1)).toBe(false);
  });

  it('waits before asking again for an area whose answer failed, and asks again once the source changes', async () => {
    let now = 1000;
    const source = vi.fn(async () => ({ error: 'not connected' }));
    const m = manager(null, { source: source as any, now: () => now });
    expect(m.canLoad(1)).toBe(true);
    await m.loadArea(1, 0, box);
    expect(m.canLoad(1)).toBe(false);
    now += 29000;
    expect(m.canLoad(1)).toBe(false);
    now += 2000;
    expect(m.canLoad(1)).toBe(true);
    await m.loadArea(1, 0, box);
    m.setSource(source as any);
    expect(m.canLoad(1)).toBe(true);
  });

  it('draws the quest\'s own spawns only on their own map', async () => {
    const m = manager({ creatures: [], objects: [], capped: { creatures: false, objects: false } });
    m.setOwnSpawns({ creatures: [creature(8, 1, { own: true, map: 1, x: 0.5, y: 0.5 }), creature(9, 1, { own: true, map: 0, x: 0.5, y: 0.5 })], objects: [], capped: { creatures: false, objects: false } });
    const group = (await m.loadArea(1, 0, box))!;
    expect(group.getObjectByName('creatures')!.children.map((c) => c.userData.spawn.guid)).toEqual([9]);
  });
});

describe('event spawns', () => {
  const holiday = { id: 12, name: "Hallow's End" };
  const fair = { id: 3, name: 'Darkmoon Faire' };
  const spawns = () => ({
    creatures: [
      creature(1, 1),
      creature(2, 1, { event: holiday, events: [holiday] }),
      creature(4, 1, { event: fair, events: [fair] }),
      // Always there, except while Hallow's End runs
      creature(5, 1, { removedBy: [holiday] }),
      // Brought by either event
      creature(6, 1, { event: fair, events: [fair, holiday] }),
    ],
    objects: [object(3, 2, { event: holiday, events: [holiday] })],
    capped: { creatures: false, objects: false },
  });
  const visibility = (events: 'none' | 'all' | number) => ({ creatures: true, objects: true, paths: true, events });

  it('draws the everyday world with no event: none of the event spawns, and those an event would take away', async () => {
    const m = manager(spawns());
    const group = (await m.loadArea(1, 0, box))!;
    const guids = () => [...group.getObjectByName('creatures')!.children, ...group.getObjectByName('objects')!.children].map((c) => c.userData.spawn.guid).sort((a, b) => a - b);
    expect(guids()).toEqual([1, 5]);

    // One event: its own spawns join the everyday ones, and the spawns it takes away go
    await m.setVisibility(visibility(12));
    expect(guids()).toEqual([1, 2, 3, 6]);
    await m.setVisibility(visibility(3));
    expect(guids()).toEqual([1, 4, 5, 6]);

    // All events: every spawn the database has here, as before
    await m.setVisibility(visibility('all'));
    expect(guids()).toEqual([1, 2, 3, 4, 5, 6]);
    await m.setVisibility(visibility('none'));
    expect(guids()).toEqual([1, 5]);
  });

  it('lists the events that have spawns in the loaded areas, by name, whether they bring spawns or take them away', async () => {
    const m = manager({ creatures: [creature(1, 1), creature(5, 1, { removedBy: [{ id: 26, name: "Children's Week" }] }), creature(6, 1, { event: fair, events: [fair, holiday] })], objects: [], capped: { creatures: false, objects: false } });
    expect(m.status.events).toEqual([]);
    await m.loadArea(1, 0, box);
    expect(m.status.events).toEqual([{ id: 26, name: "Children's Week" }, fair, holiday]);
  });
});

describe('picking a spawn', () => {
  const marker = async (spawns: object[]) => {
    const m = manager({ creatures: spawns, objects: [], capped: { creatures: false, objects: false } });
    await m.loadArea(1, 0, box);
    return m;
  };
  // Looking north (+X) along the ground at waist height
  const ray = (from = -20) => new THREE.Ray(new THREE.Vector3(from, 0, 1), new THREE.Vector3(1, 0, 0));

  it('gives the nearest drawn spawn along the ray, with what it is', async () => {
    const m = await marker([creature(1, 0, { x: 10, name: 'Far', entry: 7 }), creature(2, 0, { x: 5, name: 'Near', entry: 8 })]);
    expect(m.pick(ray())).toMatchObject({ kind: 'creature', guid: 2, entry: 8, name: 'Near', own: false, event: null, position: { x: 5, y: 0, z: 0 } });
  });

  it('gives nothing when something solid is nearer, or the spawn is hidden', async () => {
    const m = await marker([creature(1, 0, { x: 10 })]);
    expect(m.pick(ray(), 15)).toBeNull();
    m.setVisibility({ creatures: false, objects: true, paths: true, events: 'none' });
    expect(m.pick(ray())).toBeNull();
  });

  it('passes over a spawn the ray starts inside', async () => {
    const m = await marker([creature(1, 0, { x: 0 }), creature(2, 0, { x: 10 })]);
    expect(m.pick(ray(0))?.guid).toBe(2);
  });

  describe('an NPC inside an object', () => {
    // A tent: an object drawn as a building ten yards across, whose box the ray enters first
    const tent = (extra: object = {}) => object(5, 2, { x: 10, ...extra });
    const withTent = async (creatures: object[], objects = [tent()]) => {
      const big = new THREE.BoxGeometry(10, 10, 6);
      big.translate(0, 0, 3);
      const m = manager({ creatures, objects, capped: { creatures: false, objects: false } }, { createBuilding: async () => new THREE.Mesh(big) });
      await m.loadArea(1, 0, box);
      return m;
    };

    it('picks the NPC, not the tent that holds it', async () => {
      const m = await withTent([creature(1, 0, { x: 10, y: 0 })]);
      expect(m.pick(ray())).toMatchObject({ kind: 'creature', guid: 1 });
    });

    it('still picks the tent where no NPC is inside it', async () => {
      const m = await withTent([creature(1, 0, { x: 10, y: 20 })]);
      expect(m.pick(ray())).toMatchObject({ kind: 'object', guid: 5 });
    });

    it('picks an NPC in front of a tent, and the tent when the ray misses the NPC', async () => {
      const m = await withTent([creature(1, 0, { x: -5, y: 0 })]);
      expect(m.pick(ray())).toMatchObject({ kind: 'creature', guid: 1 });
      expect(m.pick(new THREE.Ray(new THREE.Vector3(-20, 3, 1), new THREE.Vector3(1, 0, 0)))).toMatchObject({ kind: 'object', guid: 5 });
    });
  });

  it('finds the drawn object of a spawn for its outline', async () => {
    const m = await marker([creature(1, 0, { x: 10 })]);
    expect(m.find('creature', 1)?.userData.spawn.guid).toBe(1);
    expect(m.find('creature', 9)).toBeNull();
  });
});

describe('the world layer in the view', () => {
  const layer: WorldLayer = {
    spawns: [
      { kind: 'creature' as const, guid: 1, entry: 1, name: 'n', map: 0, original: { x: 0, y: 0, z: 0, orientation: 0, rotation: null }, current: { x: 30, y: 0, z: 0, orientation: 1, rotation: null } },
      { kind: 'gameobject' as const, guid: 3, entry: 2, name: 'o', map: 0, original: { x: 0, y: 0, z: 0, orientation: 0, rotation: [0, 0, 0, 1] as [number, number, number, number] }, current: { x: 40, y: 0, z: 0, orientation: 0, rotation: [0, 0, 1, 0] as [number, number, number, number] } },
    ],
    routes: [{ pathId: 77, walkers: 1, original: [], current: [{ x: 5, y: 0, z: 0, rest: { delay: '0' } }, { x: 6, y: 0, z: 0, rest: {} }] }],
    added: [],
  };

  it('draws moved spawns where the layer has them, and edited routes as edited', async () => {
    const m = manager({ creatures: [creature(1, 1), creature(2, 1, { pathId: 77, path: [{ x: 1, y: 0, z: 0 }] })], objects: [object(3, 2)], capped: { creatures: false, objects: false } });
    const group = (await m.loadArea(1, 0, box))!;
    await m.setWorldLayer(layer);
    const byGuid = (name: string, guid: number) => group.getObjectByName(name)!.children.find((c) => c.userData.spawn.guid === guid)!;
    expect(byGuid('creatures', 1).position.x).toBe(30);
    expect(byGuid('objects', 3).quaternion.toArray()).toEqual([0, 0, 1, 0]);
    expect(m.route(2)).toMatchObject({ pathId: 77, own: false, points: [{ x: 5, carry: { delay: '0' } }, { x: 6, carry: {} }] });
  });

  describe('spawns placed in the view', () => {
    const look = { displayId: 1, scale: 1, equipment: [0, 0, 0] as [number, number, number], preset: null };
    const placed: WorldLayer = {
      spawns: [],
      routes: [],
      added: [
        { kind: 'creature', guid: 90001, entry: 5, name: 'Placed', map: 0, placement: { x: 0.5, y: 0.5, z: 0, orientation: 1, rotation: null }, look },
        { kind: 'gameobject', guid: 90002, entry: 6, name: 'Placed object', map: 0, placement: { x: 0.2, y: 0.2, z: 0, orientation: Math.PI, rotation: null }, look: { ...look, displayId: 2, scale: 2 } },
        { kind: 'creature', guid: 90003, entry: 5, name: 'Elsewhere', map: 1, placement: { x: 0.5, y: 0.5, z: 0, orientation: 0, rotation: null }, look },
        { kind: 'creature', guid: 90004, entry: 5, name: 'Out of the area', map: 0, placement: { x: 500, y: 0.5, z: 0, orientation: 0, rotation: null }, look },
      ],
    };

    it('draws them in the area that holds them, as their template looked, and tags them as placed', async () => {
      const m = manager({ creatures: [creature(1, 1)], objects: [], capped: { creatures: false, objects: false } });
      const group = (await m.loadArea(1, 0, box))!;
      await m.setWorldLayer(placed);
      const creatures = group.getObjectByName('creatures')!.children;
      expect(creatures.map((c) => [c.userData.spawn.guid, c.userData.spawn.added])).toEqual([[1, false], [90001, true]]);
      expect(creatures[1]!.userData.spawn).toMatchObject({ kind: 'creature', entry: 5, name: 'Placed', own: false });
      const [object] = group.getObjectByName('objects')!.children;
      expect(object!.userData.spawn).toMatchObject({ guid: 90002, added: true });
      // An object turned a half turn about Z by its facing, at its template's size
      expect(object!.quaternion.z).toBeCloseTo(1);
      expect(object!.scale.x).toBe(2);
    });

    it('takes them out again when the layer no longer has them', async () => {
      const m = manager({ creatures: [creature(1, 1)], objects: [], capped: { creatures: false, objects: false } });
      const group = (await m.loadArea(1, 0, box))!;
      await m.setWorldLayer(placed);
      await m.setWorldLayer({ spawns: [], routes: [], added: [] });
      expect(group.getObjectByName('creatures')!.children.map((c) => c.userData.spawn.guid)).toEqual([1]);
      expect(group.getObjectByName('objects')!.children).toHaveLength(0);
    });
  });

  it('draws a layer movement: the wander circle’s radius, and a new path from the layer’s route', async () => {
    const m = manager({ creatures: [creature(1, 1), creature(2, 1)], objects: [], capped: { creatures: false, objects: false } });
    await m.loadArea(1, 0, box);
    await m.setWorldLayer({ spawns: [], added: [],
      routes: [{ pathId: 900, walkers: 1, original: [], current: [{ x: 5, y: 0, z: 0, rest: {} }, { x: 6, y: 0, z: 0, rest: {} }] }],
      movements: [
        { guid: 1, entry: 1, name: 'n', map: 0, addonRow: false, original: { type: 'idle', wander: 0, pathId: null }, current: { type: 'wander', wander: 7, pathId: null } },
        { guid: 2, entry: 1, name: 'n', map: 0, addonRow: false, original: { type: 'idle', wander: 0, pathId: null }, current: { type: 'path', wander: 0, pathId: 900 } },
      ] });
    expect(m.movement(1)).toEqual({ type: 'wander', wander: 7, pathId: null });
    expect(m.route(2)).toMatchObject({ pathId: 900, points: [{ x: 5 }, { x: 6 }] });
  });

  it('draws a pending movement until the layer comes back', async () => {
    const m = manager({ creatures: [creature(1, 1)], objects: [], capped: { creatures: false, objects: false } });
    await m.loadArea(1, 0, box);
    await m.setPendingMovement(1, { type: 'path', wander: 0, pathId: 10 });
    await m.setPendingRoute(1, [{ x: 3, y: 0, z: 0 }]);
    expect(m.route(1)).toMatchObject({ pathId: 10, points: [{ x: 3 }] });
    await m.setWorldLayer({ spawns: [], routes: [], added: [] });
    expect(m.route(1)).toBeNull();
    expect(m.movement(1)).toEqual({ type: 'idle', wander: 0, pathId: null });
  });

  it('drops a pending movement when the quest\u2019s own spawns come back', async () => {
    const m = manager({ creatures: [], objects: [], capped: { creatures: false, objects: false } });
    await m.loadArea(1, 0, box);
    const own = { creatures: [creature(900, 1, { own: true, x: 0.5, y: 0.5 })], objects: [], capped: { creatures: false, objects: false } };
    await m.setOwnSpawns(own);
    await m.setPendingMovement(900, { type: 'wander', wander: 9, pathId: null });
    expect(m.movement(900)).toEqual({ type: 'wander', wander: 9, pathId: null });
    await m.setOwnSpawns(own);
    expect(m.movement(900)).toEqual({ type: 'idle', wander: 0, pathId: null });
  });

  it('describes a drawn spawn for the menu', async () => {
    const m = manager({ creatures: [creature(1, 1, { x: 0.5, y: 0.5, orientation: 2, wander: 4 })], objects: [], capped: { creatures: false, objects: false } });
    await m.loadArea(1, 0, box);
    expect(m.info('creature', 1)).toEqual({ kind: 'creature', guid: 1, entry: 1, name: 'n', own: false, added: false, pathId: 0, wander: 4, map: 0, group: null, respawnSecs: 300,
      placement: { x: 0.5, y: 0.5, z: 0, orientation: 2, rotation: null }, spawnEvents: 'npc', eventsNow: { during: [], gone: [] } });
    expect(m.info('creature', 99)).toBeNull();
  });

  it('describes a spawn whose own events are always as always, not as following its NPC', async () => {
    const m = manager({ creatures: [creature(1, 1, { x: 0.5, y: 0.5 })], objects: [], capped: { creatures: false, objects: false } });
    await m.loadArea(1, 0, box);
    await m.setWorldLayer({ spawns: [], routes: [], added: [], spawnEvents: [{ guid: 1, entry: 1, name: 'n', map: 0, original: [], current: null }] });
    expect(m.info('creature', 1)!.spawnEvents).toBeNull();
  });

  it('says which spawn group a drawn spawn is in, as the world layer has the groups', async () => {
    const m = manager({ creatures: [creature(1, 1, { x: 0.5, y: 0.5, group: 7 }), creature(2, 1, { x: 0.5, y: 0.5, group: 8 }), creature(3, 1, { x: 0.5, y: 0.5, group: null })], objects: [object(4, 2, { x: 0.5, y: 0.5, group: 7 })], capped: { creatures: false, objects: false } });
    await m.loadArea(1, 0, box);
    expect([m.info('creature', 1)!.group, m.info('creature', 2)!.group, m.info('creature', 3)!.group, m.info('object', 4)!.group]).toEqual([7, 8, null, 7]);
    const existing = { kind: 'existing' as const, original: { template: {}, members: [], event: null } };
    await m.setWorldLayer({ spawns: [], routes: [], added: [], groups: [
      // Group 7 kept the object but let NPC 1 go; NPC 3 joined new group 9; group 8 was deleted
      { id: 7, name: 'a', map: 0, maxActive: 1, event: null, origin: existing, members: [{ type: 'spawn', kind: 'object', guid: 4, entry: 2, chance: 0 }] },
      { id: 9, name: 'b', map: 0, maxActive: 1, event: null, origin: { kind: 'new' }, members: [{ type: 'spawn', kind: 'npc', guid: 3, entry: 1, chance: 0 }] },
      { id: 8, name: 'c', map: 0, maxActive: 1, event: null, origin: existing, removed: true, members: [{ type: 'spawn', kind: 'npc', guid: 2, entry: 1, chance: 0 }] },
    ] });
    expect([m.info('creature', 1)!.group, m.info('creature', 2)!.group, m.info('creature', 3)!.group, m.info('object', 4)!.group]).toEqual([null, null, 9, 7]);
  });

  it("a layer group's event overrides the database's for its spawns", async () => {
    const m = manager({ creatures: [creature(1, 1, { x: 0.5, y: 0.5 })], objects: [], capped: { creatures: false, objects: false } });
    await m.loadArea(1, 0, box);
    await m.setWorldLayer({ spawns: [], routes: [], added: [], groups: [
      { id: 9, name: 'b', map: 0, maxActive: 1, event: { id: 4, during: true }, origin: { kind: 'new' }, members: [{ type: 'spawn', kind: 'npc', guid: 1, entry: 1, chance: 0 }] },
    ] });
    expect(m.info('creature', 1)).toBeNull();
    await m.setVisibility({ creatures: true, objects: true, paths: true, events: 4 });
    expect(m.info('creature', 1)).not.toBeNull();
  });

  describe("a layer group's event in the Event filter", () => {
    const fair = { id: 5, name: 'Fair' };
    const darkmoon = { id: 12, name: 'Darkmoon' };
    const empty = { creatures: [], objects: [], capped: { creatures: false, objects: false } };
    const at = { x: 0.5, y: 0.5 };
    const drawn = async (m: SpawnManager, events: 'none' | 'all' | number, guids: number[]) => {
      await m.setVisibility({ creatures: true, objects: true, paths: true, events });
      return guids.filter((g) => m.info('creature', g) !== null);
    };
    const group = (id: number, members: any[], event: { id: number; during: boolean } | null = null, origin: any = { kind: 'new' }) => ({ id, name: 'g', map: 0, maxActive: 1, event, origin, members });
    const spawnMember = (guid: number) => ({ type: 'spawn', kind: 'npc', guid, entry: 1, chance: 0 });
    const groupMember = (id: number) => ({ type: 'group', id, chance: 0 });

    it("reaches the spawns of the groups inside an event-tied group: the layer's copy, else the database's", async () => {
      // NPC 1 is in database group 20; NPC 2 in layer group 10; both sit inside new group 9, tied to event 4
      const m = manager({ ...empty, creatures: [creature(1, 1, { ...at, group: 20, poolTop: 20 }), creature(2, 1, { ...at }), creature(3, 1, { ...at })] });
      await m.loadArea(1, 0, box);
      await m.setWorldLayer({ spawns: [], routes: [], added: [], groups: [
        group(9, [groupMember(20), groupMember(10)], { id: 4, during: true }),
        group(10, [spawnMember(2)]),
      ] } as any);
      expect(await drawn(m, 'none', [1, 2, 3])).toEqual([3]);
      expect(await drawn(m, 4, [1, 2, 3])).toEqual([1, 2, 3]);
    });

    it("walks through database groups the loaded spawns do not name, by the group's full membership", async () => {
      // NPC 1 is in database group 21, inside database group 20, inside database group 19 (its row's top);
      // the layer has group 19 let go of 20, which new group 9 (tied to event 4) holds
      const m = manager({ ...empty, creatures: [creature(1, 1, { ...at, group: 21, poolTop: 19 }), creature(2, 1, { ...at, group: 19, poolTop: 19 })] });
      await m.loadArea(1, 0, box);
      await m.setWorldLayer({ spawns: [], routes: [], added: [], groups: [
        group(9, [groupMember(20)], { id: 4, during: true }),
        group(19, [spawnMember(2)], null, { kind: 'existing', original: { template: {}, members: [], event: null } }),
      ] } as any);
      await m.setGroupSpawns(new globalThis.Map([[9, [{ kind: 'npc' as const, guid: 1 }]]]));
      expect(await drawn(m, 'none', [1, 2])).toEqual([2]);
      expect(await drawn(m, 4, [1, 2])).toEqual([1, 2]);
    });

    it("a top-level group whose event was cleared takes it off every spawn under it, and a deleted one off its own", async () => {
      // NPC 1 sits in database group 21, inside 20, which the layer moved from 30 (still tied to event 12
      // in the layer) into 19, whose event the layer cleared; NPC 2 is under deleted group 31 by a database
      // group its row does not name as its top
      const poolEvent = (pool: number) => ({ pool, id: 12, during: true, alsoOwn: false });
      const existing = { kind: 'existing', original: { template: {}, members: [], event: { eventEntry: '12' } } };
      const m = manager({ ...empty, creatures: [
        creature(1, 1, { ...at, group: 21, poolTop: 30, event: darkmoon, events: [darkmoon], poolEvent: poolEvent(30) }),
        creature(2, 1, { ...at, group: 33, poolTop: 32, event: darkmoon, events: [darkmoon], poolEvent: poolEvent(32) }),
      ] });
      await m.loadArea(1, 0, box);
      await m.setWorldLayer({ spawns: [], routes: [], added: [], groups: [
        group(19, [groupMember(20)], null, existing),
        group(30, [], { id: 12, during: true }, existing),
        { ...group(31, [], null, existing), removed: true },
        group(32, [], { id: 12, during: true }, existing),
      ] } as any);
      await m.setGroupSpawns(new globalThis.Map([[19, [{ kind: 'npc' as const, guid: 1 }]], [31, [{ kind: 'npc' as const, guid: 2 }]]]));
      expect(await drawn(m, 'none', [1, 2])).toEqual([1, 2]);
    });

    it("merges the group's event with the spawn's own events instead of replacing them", async () => {
      const m = manager({ ...empty, creatures: [creature(1, 1, { ...at, event: fair, events: [fair] })] });
      await m.loadArea(1, 0, box);
      await m.setWorldLayer({ spawns: [], routes: [], added: [], groups: [group(9, [spawnMember(1)], { id: 4, during: true })] } as any);
      expect(await drawn(m, 5, [1])).toEqual([1]);
      expect(await drawn(m, 4, [1])).toEqual([1]);
      expect(await drawn(m, 'none', [1])).toEqual([]);
    });

    it("a cleared event takes away only the group's own database event, not the spawn's", async () => {
      const original = { template: {}, members: [], event: { eventEntry: '12', pool_entry: '7' } };
      const m = manager({ ...empty, creatures: [
        creature(1, 1, { ...at, group: 7, poolTop: 7, event: fair, events: [fair, darkmoon], poolEvent: { pool: 7, id: 12, during: true, alsoOwn: false } }),
        creature(2, 1, { ...at, group: 7, poolTop: 7, event: darkmoon, events: [darkmoon], poolEvent: { pool: 7, id: 12, during: true, alsoOwn: false } }),
      ] });
      await m.loadArea(1, 0, box);
      expect(await drawn(m, 'none', [1, 2])).toEqual([]);
      await m.setWorldLayer({ spawns: [], routes: [], added: [], groups: [group(7, [spawnMember(1), spawnMember(2)], null, { kind: 'existing', original })] } as any);
      expect(await drawn(m, 'none', [1, 2])).toEqual([2]);
      expect(await drawn(m, 5, [1, 2])).toEqual([1, 2]);
      expect(await drawn(m, 12, [1, 2])).toEqual([2]);
    });

    it("a spawn the layer took out of a database event group loses that group's event", async () => {
      const original = { template: {}, members: [], event: { eventEntry: '12', pool_entry: '7' } };
      const m = manager({ ...empty, creatures: [
        creature(1, 1, { ...at, group: 7, poolTop: 7, event: darkmoon, events: [darkmoon], poolEvent: { pool: 7, id: 12, during: true, alsoOwn: false } }),
        creature(2, 1, { ...at, group: 7, poolTop: 7, event: darkmoon, events: [darkmoon], poolEvent: { pool: 7, id: 12, during: true, alsoOwn: false } }),
      ] });
      await m.loadArea(1, 0, box);
      await m.setWorldLayer({ spawns: [], routes: [], added: [], groups: [group(7, [spawnMember(2)], { id: 12, during: true }, { kind: 'existing', original })] } as any);
      expect(await drawn(m, 'none', [1, 2])).toEqual([1]);
    });

    it("hides the project's own and placed spawns in an Only during group under the everyday world", async () => {
      const m = manager(empty);
      await m.loadArea(1, 0, box);
      await m.setOwnSpawns({ ...empty, creatures: [creature(6, 1, { ...at, own: true })] });
      const look = { displayId: 1, scale: 1, equipment: [0, 0, 0] as [number, number, number], preset: null };
      await m.setWorldLayer({ spawns: [], routes: [], added: [{ kind: 'creature', guid: 7, entry: 1, name: 'n', map: 0, placement: { x: 0.5, y: 0.5, z: 0, orientation: 0, rotation: null }, look }],
        groups: [group(9, [spawnMember(6), spawnMember(7)], { id: 4, during: true })] } as any);
      expect(await drawn(m, 'none', [6, 7])).toEqual([]);
      expect(await drawn(m, 4, [6, 7])).toEqual([6, 7]);
      expect(await drawn(m, 5, [6, 7])).toEqual([]);
    });
  });

  it("describes a spawn's respawn time: the layer's edit over the database's, and a placed spawn's own or 300", async () => {
    const m = manager({ creatures: [creature(1, 1, { x: 0.5, y: 0.5, respawnSecs: 120 })], objects: [object(5, 2, { x: 0.5, y: 0.5, respawnSecs: 60 })], capped: { creatures: false, objects: false } });
    await m.loadArea(1, 0, box);
    expect(m.info('creature', 1)!.respawnSecs).toBe(120);
    const look = { displayId: 1, scale: 1, equipment: [0, 0, 0] as [number, number, number], preset: null };
    const placement = { x: 0.5, y: 0.5, z: 0, orientation: 0, rotation: null };
    await m.setWorldLayer({ spawns: [], routes: [],
      added: [{ kind: 'creature', guid: 7, entry: 1, name: 'n', map: 0, placement, look }, { kind: 'creature', guid: 8, entry: 1, name: 'n', map: 0, placement, look, respawnSecs: 45 }],
      respawns: [
        { kind: 'creature', guid: 1, entry: 1, name: 'n', map: 0, original: 120, current: 900 },
        { kind: 'gameobject', guid: 5, entry: 2, name: 'o', map: 0, original: 60, current: 10 },
      ] });
    expect(m.info('creature', 1)!.respawnSecs).toBe(900);
    expect(m.info('object', 5)!.respawnSecs).toBe(10);
    expect(m.info('creature', 7)!.respawnSecs).toBe(300);
    expect(m.info('creature', 8)!.respawnSecs).toBe(45);
  });

  it("describes an object's template type: the database's, a placed spawn's look, or none when that look predates it", async () => {
    const m = manager({ creatures: [], objects: [object(5, 2, { x: 0.5, y: 0.5, objectType: 3 })], capped: { creatures: false, objects: false } });
    await m.loadArea(1, 0, box);
    expect(m.info('object', 5)!.objectType).toBe(3);
    const look = { displayId: 2, scale: 1, equipment: [0, 0, 0] as [number, number, number], preset: null };
    const placement = { x: 0.5, y: 0.5, z: 0, orientation: 0, rotation: null };
    await m.setWorldLayer({ spawns: [], routes: [], added: [
      { kind: 'gameobject', guid: 6, entry: 2, name: 'o', map: 0, placement, look: { ...look, objectType: 10 } },
      { kind: 'gameobject', guid: 7, entry: 2, name: 'o', map: 0, placement, look },
    ] });
    expect(m.info('object', 6)!.objectType).toBe(10);
    expect(m.info('object', 7)!.objectType).toBeUndefined();
  });

  it('picks a route point of the selected NPC by its ball', async () => {
    const m = manager({ creatures: [creature(2, 0, { pathId: 77, path: [{ x: 10, y: 0, z: 1 }, { x: 20, y: 0, z: 1 }] })], objects: [], capped: { creatures: false, objects: false } });
    await m.loadArea(1, 0, box);
    m.setActiveRoutes([2]);
    m.cull(new THREE.Vector3(0, 0, 0));
    const down = (x: number) => new THREE.Ray(new THREE.Vector3(x, 0, 50), new THREE.Vector3(0, 0, -1));
    expect(m.pickRoutePoint(down(20.3), 2)).toBe(1);
    expect(m.pickRoutePoint(down(15), 2)).toBeNull();
    expect(m.pickRoutePoint(down(10), 9)).toBeNull();
  });
});

describe('how many areas are still loading', () => {
  it('counts an area from when it is asked for until it is drawn, or its answer fails', async () => {
    let answer!: (v: unknown) => void;
    const m = manager(null, { source: () => new Promise((r) => (answer = r)) as any });
    expect(m.loading).toBe(0);
    const loading = m.loadArea(1, 0, box);
    expect(m.loading).toBe(1);
    answer({ creatures: [creature(1, 1)], objects: [], capped: { creatures: false, objects: false } });
    await loading;
    expect(m.loading).toBe(0);
    const failing = m.loadArea(2, 0, box);
    expect(m.loading).toBe(1);
    answer({ error: 'not connected' });
    await failing;
    expect(m.loading).toBe(0);
  });
});

describe('NPCs dressed by a display preset', () => {
  it('asks for the look of its display with its preset', async () => {
    const asked: unknown[][] = [];
    const preset = { race: 1, sex: 1, skin: 1, face: 3, hairStyle: 7, hairColour: 0, facialHair: 3, items: {} };
    const m = manager({ creatures: [creature(1, 50, { preset }), creature(2, 1)], objects: [], capped: { creatures: false, objects: false } }, {
      resolver: { creature: async (...args: unknown[]) => { asked.push(args); return null; }, object: async () => null } as any,
    });
    await m.loadArea(1, 0, box);
    expect(asked).toEqual([[50, preset], [1, null]]);
  });
});

describe('dressed NPCs', () => {
  it('wears the body texture built for it, and its helmet and shoulders at their points', async () => {
    const attached: number[] = [];
    const created: any[] = [];
    const model = () => Object.assign(new THREE.Object3D(), { attachmentObject: (point: number) => { attached.push(point); return new THREE.Object3D(); } });
    const look = { kind: 'model', path: 'Body.m2', textures: { 1: 'Skin.blp' }, geosets: [0], scale: 1, body: { base: 'Skin.blp', layers: [] },
      attachments: [{ point: 11, look: { kind: 'model', path: 'Helm.m2', textures: {}, geosets: null, scale: 1 } }] };
    const m = manager({ creatures: [creature(1, 50)], objects: [], capped: { creatures: false, objects: false } }, {
      resolver: { creature: async () => look, object: async () => null, weapon: async () => null } as any,
      createModel: async (l: any) => { created.push(l); return model(); },
      bodyTexture: async () => 'composed\\abc.blp',
    });
    await m.loadArea(1, 0, box);
    expect(created[0].textures[1]).toBe('composed\\abc.blp');
    expect(created[1].path).toBe('Helm.m2');
    expect(attached).toEqual([11]);
  });

  it('keeps the bare skin when the body texture cannot be built', async () => {
    const created: any[] = [];
    const look = { kind: 'model', path: 'Body.m2', textures: { 1: 'Skin.blp' }, geosets: [0], scale: 1, body: { base: 'Skin.blp', layers: [] } };
    const m = manager({ creatures: [creature(1, 50)], objects: [], capped: { creatures: false, objects: false } }, {
      resolver: { creature: async () => look, object: async () => null } as any,
      createModel: async (l: any) => { created.push(l); return new THREE.Object3D(); },
      bodyTexture: async () => null,
    });
    await m.loadArea(1, 0, box);
    expect(created[0].textures[1]).toBe('Skin.blp');
  });
});

describe('one dressed-NPC texture builder for every world', () => {
  it('is shared, as the texture manager it registers with is', async () => {
    // jsdom has no workers; the texture manager only starts one
    vi.stubGlobal('Worker', class { postMessage() {} addEventListener() {} removeEventListener() {} terminate() {} });
    const { sharedManagers } = await import('../../src/renderer/world3d/world3d');
    expect(sharedManagers().characterTexture).toBeDefined();
    expect(sharedManagers().characterTexture).toBe(sharedManagers().characterTexture);
    vi.unstubAllGlobals();
  });
});

describe('a route edited in the view', () => {
  it('is read back as edited at once, before the area is drawn again', async () => {
    const m = manager({ creatures: [creature(2, 0, { pathId: 77, path: [{ x: 10, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }] })], objects: [], capped: { creatures: false, objects: false } });
    await m.loadArea(1, 0, box);
    const drawing = m.setPendingRoute(2, [{ x: 10, y: 5, z: 0 }, { x: 20, y: 0, z: 0 }]);
    expect(m.route(2)!.points[0]).toEqual({ x: 10, y: 5, z: 0 });
    await drawing;
  });
});

describe('a changed world layer, drawn in place', () => {
  const moved = (x: number): WorldLayer => ({
    spawns: [{ kind: 'creature', guid: 1, entry: 1, name: 'n', map: 0, original: { x: 0, y: 0, z: 0, orientation: 0, rotation: null }, current: { x, y: 0, z: 0, orientation: 1, rotation: null } }],
    routes: [],
    added: [],
  });
  const byGuid = (group: THREE.Object3D, name: string, guid: number) => group.getObjectByName(name)!.children.find((c) => c.userData.spawn.guid === guid);

  it('moves and turns the drawn spawn itself, at once, without making it again', async () => {
    let made = 0;
    const m = manager({ creatures: [creature(1, 1), creature(2, 1)], objects: [object(3, 2)], capped: { creatures: false, objects: false } }, {
      createModel: async () => { made += 1; return new THREE.Object3D(); },
    });
    const group = (await m.loadArea(1, 0, box))!;
    const [one, two, three] = [byGuid(group, 'creatures', 1), byGuid(group, 'creatures', 2), byGuid(group, 'objects', 3)];
    made = 0;
    void m.setWorldLayer(moved(30));
    // Without waiting: the move is drawn in the same moment
    expect(byGuid(group, 'creatures', 1)).toBe(one);
    expect(one!.position.x).toBe(30);
    expect(one!.userData.spawn.position.x).toBe(30);
    expect(new THREE.Vector3(1, 0, 0).applyQuaternion(one!.quaternion).y).toBeCloseTo(Math.sin(1), 6);
    expect(byGuid(group, 'creatures', 2)).toBe(two);
    expect(byGuid(group, 'objects', 3)).toBe(three);
    expect(made).toBe(0);
  });

  it('takes a moved NPC\'s route and wander circle with it', async () => {
    const m = manager({ creatures: [creature(1, 1, { wander: 5, path: [{ x: 10, y: 0, z: 0 }] })], objects: [], capped: { creatures: false, objects: false } });
    const group = (await m.loadArea(1, 0, box))!;
    await m.setWorldLayer(moved(30));
    const route = group.getObjectByName('route') as THREE.Group;
    const line = route.children.find((c) => c instanceof THREE.Line) as THREE.Line;
    expect(Array.from(line.geometry.getAttribute('position').array).slice(0, 3)).toEqual([30, 0, 0]);
    const wander = group.getObjectByName('wander') as THREE.LineLoop;
    expect(wander.geometry.getAttribute('position').getX(0)).toBeCloseTo(35, 6);
  });

  it('stands a moved NPC on the drawn ground again, from where it now is', async () => {
    const asked: number[] = [];
    const m = manager({ creatures: [creature(1, 1, { z: 10 })], objects: [], capped: { creatures: false, objects: false } }, {
      groundBelow: (x: number) => { asked.push(x); return 10.5; },
    });
    const group = (await m.loadArea(1, 0, box))!;
    m.cull(new THREE.Vector3(0, 0, 0));
    expect(asked).toEqual([0]);
    void m.setWorldLayer({ ...moved(30), spawns: [{ ...moved(30).spawns[0]!, current: { x: 30, y: 0, z: 10, orientation: 0, rotation: null } }] });
    m.cull(new THREE.Vector3(30, 0, 0));
    expect(asked).toEqual([0, 30]);
    expect(byGuid(group, 'creatures', 1)!.position.z).toBeCloseTo(10.5);
  });

  it('draws again only a spawn whose look changed', async () => {
    let made = 0;
    const spawns = { creatures: [creature(1, 1), creature(2, 1)], objects: [], capped: { creatures: false, objects: false } };
    const m = manager(spawns, { createModel: async () => { made += 1; return new THREE.Object3D(); } });
    const group = (await m.loadArea(1, 0, box))!;
    const two = byGuid(group, 'creatures', 2);
    made = 0;
    await m.setOwnSpawns({ creatures: [{ ...creature(1, 1), own: true, scale: 3 }], objects: [], capped: { creatures: false, objects: false } });
    expect(byGuid(group, 'creatures', 2)).toBe(two);
    expect(byGuid(group, 'creatures', 1)!.scale.x).toBe(3);
    expect(made).toBe(1);
  });

  it('keeps the drawn spawns when a route edited in the view is drawn', async () => {
    const m = manager({ creatures: [creature(2, 1, { pathId: 77, path: [{ x: 10, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }] })], objects: [], capped: { creatures: false, objects: false } });
    const group = (await m.loadArea(1, 0, box))!;
    const npc = byGuid(group, 'creatures', 2);
    await m.setPendingRoute(2, [{ x: 10, y: 5, z: 0 }, { x: 20, y: 0, z: 0 }]);
    expect(byGuid(group, 'creatures', 2)).toBe(npc);
    const ball = group.getObjectByName('route')!.children.find((c) => c.userData.point === 0)!;
    expect(ball.position.y).toBe(5);
  });
});

describe('an NPC being dragged', () => {
  it('takes its route\'s first leg and its wander circle with it as it goes', async () => {
    const m = manager({ creatures: [creature(1, 1, { wander: 5, path: [{ x: 10, y: 0, z: 0 }] })], objects: [], capped: { creatures: false, objects: false } });
    const group = (await m.loadArea(1, 0, box))!;
    m.previewHome(1, { x: 3, y: 4, z: 0 });
    const route = group.getObjectByName('route') as THREE.Group;
    const line = route.children.find((c) => c instanceof THREE.Line) as THREE.Line;
    expect(Array.from(line.geometry.getAttribute('position').array).slice(0, 3)).toEqual([3, 4, 0]);
    const wander = group.getObjectByName('wander') as THREE.LineLoop;
    const at = new THREE.Vector3().fromBufferAttribute(wander.geometry.getAttribute('position') as THREE.BufferAttribute, 0).applyMatrix4(wander.matrixWorld);
    expect(at.x).toBeCloseTo(8, 6);
    expect(at.y).toBeCloseTo(4, 6);
  });

  it('puts them back when the move was not kept and the layer comes back unchanged', async () => {
    const m = manager({ creatures: [creature(1, 1, { wander: 5, path: [{ x: 10, y: 0, z: 0 }] })], objects: [], capped: { creatures: false, objects: false } });
    const group = (await m.loadArea(1, 0, box))!;
    m.previewHome(1, { x: 3, y: 4, z: 0 });
    await m.setWorldLayer({ spawns: [], routes: [], added: [] });
    const route = group.getObjectByName('route') as THREE.Group;
    const line = route.children.find((c) => c instanceof THREE.Line) as THREE.Line;
    expect(Array.from(line.geometry.getAttribute('position').array).slice(0, 3)).toEqual([0, 0, 0]);
    expect((group.getObjectByName('wander') as THREE.LineLoop).position.toArray()).toEqual([0, 0, 0]);
  });
});

describe('drawing spawns through a vessel’s frame', () => {
  const spawns = (creatures: object[], objects: object[] = []) => ({ creatures, objects, capped: { creatures: false, objects: false } });
  const frame = { x: 100, y: 200, z: 5, heading: Math.PI / 2 };
  const yaw = (o: THREE.Object3D) => new THREE.Euler().setFromQuaternion(o.quaternion).z;

  it('puts a vessel-local NPC on the deck: moved, turned, and still local on its card', async () => {
    const m = manager(spawns([creature(1, 1, { x: 1, y: 0, z: 0, orientation: 0 })]), { frame });
    const group = (await m.loadArea(1, 0, box))!;
    const npc = group.getObjectByName('creatures')!.children[0]!;
    expect([npc.position.x, npc.position.y, npc.position.z].map((v) => Math.round(v * 1e4) / 1e4)).toEqual([100, 201, 5]);
    expect(yaw(npc)).toBeCloseTo(Math.PI / 2);
    expect(npc.userData.spawn.position).toEqual({ x: 1, y: 0, z: 0 });
  });

  it('turns an object with the vessel too', async () => {
    const m = manager(spawns([], [object(3, 2, { x: 0, y: 0, z: 0 })]), { frame });
    const obj = (await m.loadArea(1, 0, box))!.getObjectByName('objects')!.children[0]!;
    expect(yaw(obj)).toBeCloseTo(Math.PI / 2);
  });

  it('never lifts an NPC onto terrain while in a frame', async () => {
    const asked = vi.fn(() => 50);
    const m = manager(spawns([creature(1, 1, { z: 10 })]), { frame, groundBelow: asked });
    const group = (await m.loadArea(1, 0, box))!;
    m.cull(new THREE.Vector3(100, 200, 15));
    expect(asked).not.toHaveBeenCalled();
    expect(group.getObjectByName('creatures')!.children[0]!.position.z).toBeCloseTo(15);
  });

  it('moves everything when the frame changes', async () => {
    const m = manager(spawns([creature(1, 1, { x: 1, y: 0, z: 0 })], [object(3, 2, { x: 0, y: 2, z: 0 })]), { frame });
    const group = (await m.loadArea(1, 0, box))!;
    m.setFrame({ x: 0, y: 0, z: 0, heading: 0 });
    const npc = group.getObjectByName('creatures')!.children[0]!;
    const obj = group.getObjectByName('objects')!.children[0]!;
    expect([npc.position.x, npc.position.y]).toEqual([1, 0]);
    expect([obj.position.x, obj.position.y]).toEqual([0, 2]);
    expect(yaw(npc)).toBeCloseTo(0);
  });

  it('draws the vessel at the frame, outside every area, and takes it away again', async () => {
    const m = manager(spawns([]), { frame });
    await m.setVessel({ displayId: 2 });
    expect(m.decor.children).toHaveLength(1);
    const vessel = m.decor.children[0]!;
    expect([vessel.position.x, vessel.position.y, vessel.position.z]).toEqual([100, 200, 5]);
    expect(yaw(vessel)).toBeCloseTo(Math.PI / 2);
    expect(m.pick(new THREE.Ray(new THREE.Vector3(100, 200, 500), new THREE.Vector3(0, 0, -1)))).toBeNull();
    m.setFrame({ x: 7, y: 8, z: 9, heading: 0 });
    expect([m.decor.children[0]!.position.x, m.decor.children[0]!.position.y]).toEqual([7, 8]);
    await m.setVessel(null);
    expect(m.decor.children).toHaveLength(0);
  });

  it('draws without a vessel when its model is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = manager(spawns([]), { frame });
    await m.setVessel({ displayId: 404 });
    expect(m.decor.children).toHaveLength(0);
    warn.mockRestore();
  });

  it('is the identity by default', async () => {
    const m = manager(spawns([creature(1, 1, { x: 4, y: 5, z: 6 })]));
    const npc = (await m.loadArea(1, 0, box))!.getObjectByName('creatures')!.children[0]!;
    expect([npc.position.x, npc.position.y, npc.position.z]).toEqual([4, 5, 6]);
  });
});
