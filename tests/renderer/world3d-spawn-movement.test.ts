// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import SpawnManager from '../../src/renderer/world3d/scene/spawn/SpawnManager';
import { MovementControl } from '../../src/renderer/world3d/scene/spawn/movement-control';
import { Walkers } from '../../src/renderer/world3d/scene/spawn/walkers';

const creature = (guid: number, extra: object = {}) => ({
  guid, entry: 1, name: 'n', map: 0, x: 0, y: 0, z: 0, orientation: 0, displayId: 1, scale: 1, wander: 0, path: null, equipment: [0, 0, 0] as [number, number, number], own: false, event: null, events: [], removedBy: [], pathId: 0, preset: null, group: null, respawnSecs: 300, ...extra,
});
const walker = (extra: object = {}) => creature(1, { path: [{ x: 10, y: 0, z: 0 }], pathId: 5, ...extra });
const box = { minX: 0, maxX: 1, minY: 0, maxY: 1 };
const camera = new THREE.PerspectiveCamera();
const answer = (creatures: object[]) => ({ creatures, objects: [], capped: { creatures: false, objects: false } });

function setup(spawns: object[], options: object = {}) {
  const control = new MovementControl();
  const gaits: string[] = [];
  const manager = new SpawnManager({
    resolver: { creature: async () => ({ kind: 'model', path: 'a.m2', textures: {}, geosets: null, scale: 1 }), object: async () => null } as any,
    createModel: async () => Object.assign(new THREE.Object3D(), { animation: { setGait: (g: string) => gaits.push(g) } }),
    createBuilding: async () => new THREE.Group(),
    source: async () => answer(spawns) as any,
    movement: control,
    ...options,
  } as any);
  return { control, gaits, manager };
}
const drawn = (group: THREE.Group, guid: number) => group.getObjectByName('creatures')!.children.find((c) => c.userData.spawn?.guid === guid)!;
/** Frames of a quarter second each: the driver takes no step longer than that */
const run = (manager: SpawnManager, seconds: number) => {
  for (let t = 0; t < seconds - 1e-9; t += 0.25) manager.update(0.25, camera);
};

describe('NPCs that walk', () => {
  it('stay where they stand until played, then walk their path, switching to the walk animation', async () => {
    const { control, gaits, manager } = setup([walker()]);
    const group = (await manager.loadArea(1, 0, box))!;
    manager.cull(new THREE.Vector3(0, 0, 0));
    run(manager, 2);
    expect(drawn(group, 1).position.x).toBe(0);
    control.play();
    run(manager, 2);
    expect(drawn(group, 1).position.x).toBeCloseTo(5);
    expect(gaits).toContain('walk');
  });

  it('hold where they are on pause, and go home on reset', async () => {
    const { control, gaits, manager } = setup([walker()]);
    const group = (await manager.loadArea(1, 0, box))!;
    manager.cull(new THREE.Vector3(0, 0, 0));
    control.play();
    run(manager, 1);
    const at = drawn(group, 1).position.x;
    expect(at).toBeGreaterThan(0);
    control.pause();
    run(manager, 2);
    expect(drawn(group, 1).position.x).toBe(at);
    expect(gaits[gaits.length - 1]).toBe('stand');
    control.reset();
    manager.update(0, camera);
    expect(drawn(group, 1).position.x).toBe(0);
  });

  it('are not moved when out of range, and wanderers wander on the ground the probe finds', async () => {
    const groundBelow = vi.fn(() => 42);
    const { control, manager } = setup([creature(2, { wander: 6 })], { groundBelow });
    const group = (await manager.loadArea(1, 0, box))!;
    control.play();
    manager.cull(new THREE.Vector3(1e6, 1e6, 0));
    for (let i = 0; i < 100; i++) manager.update(0.2, camera);
    expect(drawn(group, 2).position.x).toBe(0);
    manager.cull(new THREE.Vector3(0, 0, 0));
    for (let i = 0; i < 100; i++) manager.update(0.2, camera);
    const p = drawn(group, 2).position;
    expect(Math.hypot(p.x, p.y)).toBeGreaterThan(0);
    expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(6 + 1e-6);
    expect(p.z).toBe(42);
  });

  it('stand on the lifted ground at home, as when not playing', async () => {
    const { control, manager } = setup([creature(2, { wander: 6 })], { groundBelow: () => 1 });
    const group = (await manager.loadArea(1, 0, box))!;
    manager.cull(new THREE.Vector3(0, 0, 0));
    expect(drawn(group, 2).position.z).toBe(1);
    control.play();
    run(manager, 1); // still in its first pause, at home
    expect(drawn(group, 2).position.z).toBe(1);
    control.reset();
    manager.update(0, camera);
    expect(drawn(group, 2).position.z).toBe(1);
  });

  it('respect an edited path: a changed row keeps the NPC walking from where it is', async () => {
    const { control, manager } = setup([walker()]);
    const group = (await manager.loadArea(1, 0, box))!;
    manager.cull(new THREE.Vector3(0, 0, 0));
    control.play();
    run(manager, 2);
    await manager.setWorldLayer({ spawns: [], routes: [{ pathId: 5, walkers: 1, original: [], current: [{ x: 10, y: 8, z: 0, rest: {} }] }], added: [] } as any);
    manager.update(0, camera);
    expect(drawn(group, 1).position.x).toBeCloseTo(5); // not snapped home
    control.pause();
    await manager.setLooks(new Map());
    expect(drawn(group, 1).position.x).toBeCloseTo(5); // nor by a redraw while paused
  });

  it('leave an NPC whose route is being worked on at home', async () => {
    const { control, manager } = setup([walker()]);
    const group = (await manager.loadArea(1, 0, box))!;
    manager.cull(new THREE.Vector3(0, 0, 0));
    control.play();
    run(manager, 2);
    manager.setActiveRoutes([1]);
    manager.update(1, camera);
    expect(drawn(group, 1).position.x).toBe(0);
  });

  it('stop being walked once their area goes', async () => {
    const { control, manager } = setup([walker()]);
    const group = (await manager.loadArea(1, 0, box))!;
    const npc = drawn(group, 1);
    manager.cull(new THREE.Vector3(0, 0, 0));
    manager.removeArea(1);
    control.play();
    run(manager, 2);
    expect(npc.position.x).toBe(0);
  });

  it('never walk objects or markers', async () => {
    const { control, manager } = setup([creature(3, { displayId: 0, wander: 6 })], {
      resolver: { creature: async () => null, object: async () => null },
      source: async () => ({ creatures: [creature(3, { displayId: 0, wander: 6 })], objects: [{ guid: 4, entry: 2, name: 'o', map: 0, x: 0, y: 0, z: 0, rotation: [0, 0, 0, 1], displayId: 0, scale: 1, objectType: 5, own: false, event: null, events: [], removedBy: [], group: null, respawnSecs: 300 }], capped: { creatures: false, objects: false } }),
    });
    const group = (await manager.loadArea(1, 0, box))!;
    manager.cull(new THREE.Vector3(0, 0, 0));
    control.play();
    run(manager, 30);
    expect(drawn(group, 3).name).toBe('marker');
    expect(drawn(group, 3).position.toArray()).toEqual([0, 0, 0]);
  });
});

const moveTo = (guid: number, at: { x: number; y: number; z: number; orientation: number }) => ({
  spawns: [{ kind: 'creature', guid, entry: 1, name: 'n', map: 0, original: { x: 0, y: 0, z: 0, orientation: 0, rotation: null }, current: { ...at, rotation: null } }],
  routes: [],
  added: [],
}) as any;
/** Ground that is z = -x, found only within the band it is asked to look in */
const slope = (x: number, _y: number, fromZ: number, distance: number) => (-x <= fromZ && -x >= fromZ - distance ? -x : null);

describe('NPCs that walk, edited (C1)', () => {
  for (const playing of [false, true]) {
    for (const [name, row] of [['a path NPC', walker()], ['a wanderer', creature(1, { wander: 6 })]] as const) {
      it(`draw ${name} moved or turned ${playing ? 'while playing' : 'while paused'} at its new place`, async () => {
        const { control, manager } = setup([row]);
        const group = (await manager.loadArea(1, 0, box))!;
        manager.cull(new THREE.Vector3(0, 0, 0));
        control.play();
        run(manager, 12);
        if (!playing) control.pause();
        manager.update(0.25, camera);
        await manager.setWorldLayer(moveTo(1, { x: 0.5, y: 0.25, z: 0, orientation: 0 }));
        manager.update(0, camera);
        expect(drawn(group, 1).position.toArray()).toEqual([0.5, 0.25, 0]);
        await manager.setWorldLayer(moveTo(1, { x: 0.5, y: 0.25, z: 0, orientation: 2 }));
        manager.update(0, camera);
        expect(drawn(group, 1).position.toArray()).toEqual([0.5, 0.25, 0]);
        const turned = new THREE.Euler().setFromQuaternion(drawn(group, 1).quaternion);
        expect(turned.z).toBeCloseTo(2);
      });
    }
  }
});

describe('NPCs that walk, on uneven ground (C2)', () => {
  it('follow a slope down as well as up', async () => {
    const { control, manager } = setup([creature(2, { wander: 10 })], { groundBelow: slope });
    const group = (await manager.loadArea(1, 0, box))!;
    manager.cull(new THREE.Vector3(0, 0, 0));
    control.play();
    let worst = 0;
    for (let i = 0; i < 1200; i++) {
      manager.update(0.25, camera);
      const p = drawn(group, 2).position;
      worst = Math.max(worst, Math.abs(p.z - -p.x));
    }
    expect(worst).toBeLessThan(0.6);
  });
});

describe('NPCs that walk, held and hidden', () => {
  it('send a selected NPC home while paused too (I1)', async () => {
    const { control, manager } = setup([walker()]);
    const group = (await manager.loadArea(1, 0, box))!;
    manager.cull(new THREE.Vector3(0, 0, 0));
    control.play();
    run(manager, 2);
    control.pause();
    manager.update(0.25, camera);
    expect(drawn(group, 1).position.x).toBeGreaterThan(0);
    manager.setActiveRoutes([1]);
    manager.update(0.25, camera);
    expect(drawn(group, 1).position.x).toBe(0);
  });

  it('leave NPCs where they are while their layer is hidden (I3)', async () => {
    const groundBelow = vi.fn(() => 0);
    const { control, manager } = setup([walker()], { groundBelow });
    const group = (await manager.loadArea(1, 0, box))!;
    manager.cull(new THREE.Vector3(0, 0, 0));
    await manager.setVisibility({ creatures: false, objects: true, paths: true } as any);
    control.play();
    run(manager, 2);
    expect(drawn(group, 1).position.x).toBe(0);
    await manager.setVisibility({ creatures: true, objects: true, paths: true } as any);
    run(manager, 2);
    expect(drawn(group, 1).position.x).toBeCloseTo(5);
  });

  it('walk an NPC out of view without looking for its ground, and look again once it is seen (I3)', async () => {
    const groundBelow = vi.fn(() => 0);
    const { control, manager } = setup([walker()], { groundBelow, createModel: async () => Object.assign(new THREE.Object3D(), { animation: { setGait: () => {} }, boundingSphereWorld: new THREE.Sphere(new THREE.Vector3(), 1) }) });
    const group = (await manager.loadArea(1, 0, box))!;
    const away = new THREE.Frustum(new THREE.Plane(new THREE.Vector3(1, 0, 0), -1e6));
    manager.cull(new THREE.Vector3(0, 0, 0), away);
    groundBelow.mockClear();
    control.play();
    run(manager, 2);
    expect(drawn(group, 1).position.x).toBeCloseTo(5);
    expect(groundBelow).not.toHaveBeenCalled();
    manager.cull(new THREE.Vector3(0, 0, 0), new THREE.Frustum());
    groundBelow.mockClear();
    run(manager, 2);
    // 5 yd walked: a look as it is seen again, then about one per half yard
    expect(groundBelow.mock.calls.length).toBeGreaterThan(0);
    expect(groundBelow.mock.calls.length).toBeLessThanOrEqual(11);
  });
});

describe('NPCs that walk, redrawn (M2) and drawn twice (M4)', () => {
  it('track again only the NPCs whose row changed', async () => {
    const { control, manager } = setup([walker(), creature(2, { wander: 6, x: 0.5 })]);
    await manager.loadArea(1, 0, box);
    manager.cull(new THREE.Vector3(0, 0, 0));
    control.play();
    run(manager, 2);
    const track = vi.spyOn(Walkers.prototype, 'track');
    await manager.setWorldLayer(moveTo(2, { x: 0.25, y: 0.25, z: 0, orientation: 0 }));
    expect(track.mock.calls.map(([, row]) => row.guid)).toEqual([2]);
    track.mockRestore();
  });

  it('walk both drawings of an NPC that two areas draw, and the one left when an area goes', async () => {
    const { control, manager } = setup([walker()]);
    const first = (await manager.loadArea(1, 0, box))!;
    const second = (await manager.loadArea(2, 0, box))!;
    manager.cull(new THREE.Vector3(0, 0, 0));
    control.play();
    run(manager, 2);
    expect(drawn(first, 1).position.x).toBeCloseTo(5);
    expect(drawn(second, 1).position.x).toBeCloseTo(5);
    manager.removeArea(1);
    run(manager, 1);
    expect(drawn(second, 1).position.x).toBeCloseTo(7.5);
  });
});

describe('NPCs on a vessel', () => {
  const frame = { x: 100, y: 200, z: 5, heading: 0 };

  it('walk the same path, placed through the frame and without the ground probe', async () => {
    const groundBelow = vi.fn(() => 1);
    const { control, manager } = setup([walker()], { frame, groundBelow });
    const group = (await manager.loadArea(1, 0, box))!;
    manager.cull(new THREE.Vector3(100, 200, 5));
    control.play();
    run(manager, 2);
    const p = drawn(group, 1).position;
    expect(p.x).toBeCloseTo(105);
    expect(p.y).toBeCloseTo(200);
    expect(groundBelow).not.toHaveBeenCalled();
  });

  it('keep walking from where they are when the vessel moves while paused', async () => {
    const { control, manager } = setup([walker()], { frame });
    const group = (await manager.loadArea(1, 0, box))!;
    manager.cull(new THREE.Vector3(100, 200, 5));
    control.play();
    run(manager, 2);
    control.pause();
    manager.update(0.25, camera);
    manager.setFrame({ x: 300, y: 400, z: 5, heading: 0 });
    expect(drawn(group, 1).position.x).toBeCloseTo(305);
    expect(drawn(group, 1).position.y).toBeCloseTo(400);
  });

  it('draw their routes through the frame, moving with it', async () => {
    const { manager } = setup([walker()], { frame });
    const group = (await manager.loadArea(1, 0, box))!;
    const paths = group.getObjectByName('paths')!;
    const ball = () => paths.getObjectByName('route')!.children.find((c) => typeof c.userData.point === 'number')!;
    manager.setActiveRoutes([1]);
    manager.cull(new THREE.Vector3(100, 200, 5));
    expect(paths.visible).toBe(true);
    // left out of the scene's every-frame pass, so only the manager's forced pass can move it
    expect(paths.getObjectByName('route')!.matrixWorldAutoUpdate).toBe(false);
    // the route point is vessel-local (10, 0): world is the frame plus that
    expect(ball().matrixWorld.elements[12]).toBeCloseTo(110);
    expect(ball().matrixWorld.elements[13]).toBeCloseTo(200);
    manager.setFrame({ x: 300, y: 400, z: 5, heading: Math.PI / 2 });
    expect(ball().matrixWorld.elements[12]).toBeCloseTo(300);
    expect(ball().matrixWorld.elements[13]).toBeCloseTo(410);
    expect(ball().matrixWorld.elements[14]).toBeCloseTo(5);
    manager.setFrame({ x: 0, y: 0, z: 0, heading: 0 });
    expect(ball().matrixWorld.elements[12]).toBeCloseTo(10);
    expect(ball().matrixWorld.elements[13]).toBeCloseTo(0);
  });

  it('draw a route made after the vessel moved on the vessel too', async () => {
    const { manager } = setup([creature(1)], { frame });
    const group = (await manager.loadArea(1, 0, box))!;
    manager.setFrame({ x: 300, y: 400, z: 5, heading: 0 });
    await manager.setWorldLayer({ spawns: [], routes: [], added: [], movements: [{ guid: 1, original: { type: 'idle', wander: 0, pathId: null }, current: { type: 'wander', wander: 4, pathId: null } }] } as any);
    const ring = group.getObjectByName('paths')!.getObjectByName('wander')!;
    expect(ring.matrixWorld.elements[12]).toBeCloseTo(300);
    expect(ring.matrixWorld.elements[13]).toBeCloseTo(400);
  });

  it('leave their route points to be picked off a vessel only', async () => {
    const { manager } = setup([walker()], { frame });
    await manager.loadArea(1, 0, box);
    manager.setActiveRoutes([1]);
    manager.cull(new THREE.Vector3(100, 200, 5));
    expect(manager.candidates(new THREE.Vector3(100, 200, 5)).points).toEqual([]);
  });
});
