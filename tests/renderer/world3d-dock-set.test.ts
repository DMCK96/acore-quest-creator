// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Dock } from '../../src/core/map/transport-docks';
import { DockSet, type DockInstance, type DockState } from '../../src/renderer/world3d/scene/spawn/DockSet';

const dock = (key: string, x = 0): Dock => ({ key, map: 591, template: 1, node: 0, displayId: 1, frame: { x, y: 0, z: 0, heading: 0 } });
const spawn = (guid: number) => ({ kind: 'creature' as const, guid, entry: 1, name: 'n', own: false, added: false, pathId: 0, position: { x: 0, y: 0, z: 0 } });

function fake(d: Dock, hit: { guid: number; distance: number } | null = null, has: number[] = []) {
  const instance = {
    d,
    root: new THREE.Group(),
    decor: new THREE.Group(),
    configure: vi.fn(),
    pick: vi.fn(() => (hit ? { spawn: spawn(hit.guid), distance: hit.distance } : null)),
    find: vi.fn((_k: string, guid: number) => (has.includes(guid) ? new THREE.Object3D() : null)),
    picked: vi.fn((_k: string, guid: number) => (has.includes(guid) ? spawn(guid) : null)),
    info: vi.fn(() => null),
    cull: vi.fn(),
    update: vi.fn(),
    candidates: vi.fn(() => [{ kind: 'creature' as const, guid: d.node + 1, at: { x: 0, y: 0, z: 0 } }]),
    status: { capped: { creatures: false, objects: false }, error: null as string | null },
    dispose: vi.fn(),
  };
  return instance as unknown as typeof instance & DockInstance;
}

function setup(make: (d: Dock) => ReturnType<typeof fake> = fake) {
  const made: ReturnType<typeof fake>[] = [];
  const parent = new THREE.Group();
  const set = new DockSet({ parent, create: (d) => { const f = make(d); made.push(f); return f; } });
  return { set, made, parent };
}
const always = () => true;

describe('the docks in a scene', () => {
  it('makes an instance for each dock in range, adds its root to the parent, and none for a dock out of range', () => {
    const { set, made, parent } = setup();
    set.sync([dock('a'), dock('b', 9999)], (d) => d.key === 'a');
    expect(made.map((m) => m.d.key)).toEqual(['a']);
    expect(parent.children).toEqual([made[0]!.root]);
    expect(set.decor).toHaveLength(1);
  });

  it('keeps an instance that stays in range, and disposes one that leaves range or is no longer listed', () => {
    const { set, made, parent } = setup();
    set.sync([dock('a'), dock('b')], always);
    set.sync([dock('a'), dock('b')], always);
    expect(made).toHaveLength(2);
    set.sync([dock('a'), dock('b')], (d) => d.key === 'a');
    expect(made[1]!.dispose).toHaveBeenCalledTimes(1);
    expect(parent.children).toEqual([made[0]!.root]);
    set.sync([], always);
    expect(made[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(set.decor).toHaveLength(0);
  });

  it('brings a new instance up to everything set so far, and passes later changes on to all', () => {
    const { set, made } = setup();
    const visibility = { creatures: false, objects: true, paths: true, events: 'none' as const };
    set.configure({ visibility });
    set.configure({ source: null });
    set.sync([dock('a')], always);
    // the state so far, in one call, on creation
    expect(made[0]!.configure).toHaveBeenCalledWith(expect.objectContaining({ visibility, source: null }));
    set.sync([dock('a'), dock('b')], always);
    const layer = { spawns: [], routes: [], added: [] } as unknown as DockState['layer'];
    set.configure({ layer });
    expect(made[0]!.configure).toHaveBeenLastCalledWith({ layer });
    expect(made[1]!.configure).toHaveBeenLastCalledWith({ layer });
  });

  it('draws nothing while disabled, disposes what was drawn, and draws again when enabled', () => {
    const { set, made } = setup();
    set.sync([dock('a')], always);
    set.setEnabled(false);
    expect(made[0]!.dispose).toHaveBeenCalledTimes(1);
    set.sync([dock('a')], always);
    expect(made).toHaveLength(1);
    expect(set.decor).toHaveLength(0);
    set.setEnabled(true);
    set.sync([dock('a')], always);
    expect(made).toHaveLength(2);
  });

  it('picks the nearest hit across instances, within the distance asked', () => {
    const hits = new Map([['a', { guid: 1, distance: 30 }], ['b', { guid: 2, distance: 10 }]]);
    const { set } = setup((d) => fake(d, hits.get(d.key)));
    set.sync([dock('a'), dock('b')], always);
    const ray = new THREE.Ray();
    expect(set.pickHit(ray)?.spawn.guid).toBe(2);
    expect(set.pickHit(ray, 5)).toBeNull();
  });

  it('finds a spawn in the instance that has it, and says whose frame it stands in', () => {
    const { set } = setup((d) => fake(d, null, d.key === 'b' ? [7] : []));
    set.sync([dock('a', 1), dock('b', 2)], always);
    expect(set.find('creature', 7)).not.toBeNull();
    expect(set.picked('creature', 7)?.guid).toBe(7);
    expect(set.frameOf('creature', 7)).toEqual({ x: 2, y: 0, z: 0, heading: 0 });
    expect(set.frameOf('creature', 8)).toBeNull();
    expect(set.find('creature', 8)).toBeNull();
  });

  it('lists the vessels of the docks drawn, to stand on', () => {
    const { set, made } = setup();
    set.sync([dock('a'), dock('b')], always);
    expect(set.decor).toEqual([made[0]!.decor, made[1]!.decor]);
    set.sync([dock('b')], always);
    expect(set.decor).toEqual([made[1]!.decor]);
  });

  it('lets every instance work between frames, and gathers what a box can catch from them all', () => {
    const { set, made } = setup((d) => fake({ ...d, node: d.key === 'a' ? 1 : 2 }));
    set.sync([dock('a'), dock('b')], always);
    set.update();
    expect(made.map((m) => m.update.mock.calls.length)).toEqual([1, 1]);
    expect(set.candidates(new THREE.Vector3()).map((c) => c.guid)).toEqual([2, 3]);
  });

  it('says why a dock has no passengers, and whether any kind was capped', () => {
    const { set, made } = setup();
    expect(set.status).toEqual({ capped: { creatures: false, objects: false }, error: null });
    set.sync([dock('a'), dock('b')], always);
    made[1]!.status = { capped: { creatures: true, objects: false }, error: 'not connected' };
    made[0]!.status = { capped: { creatures: false, objects: true }, error: null };
    expect(set.status).toEqual({ capped: { creatures: true, objects: true }, error: 'not connected' });
  });

  it('culls every instance, and disposes them all with dispose', () => {
    const { set, made, parent } = setup();
    set.sync([dock('a'), dock('b')], always);
    const camera = new THREE.Vector3();
    set.cull(camera);
    expect(made.map((m) => m.cull.mock.calls.length)).toEqual([1, 1]);
    set.dispose();
    expect(made.every((m) => m.dispose.mock.calls.length === 1)).toBe(true);
    expect(parent.children).toHaveLength(0);
  });
});
