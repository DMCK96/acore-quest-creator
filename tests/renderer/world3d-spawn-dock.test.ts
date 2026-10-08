// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Dock } from '../../src/core/map/transport-docks';
import SpawnManager from '../../src/renderer/world3d/scene/spawn/SpawnManager';
import { createSpawnDock, DOCK_AREA } from '../../src/renderer/world3d/scene/spawn/SpawnDock';

const dock: Dock = { key: '591:0', map: 591, template: 1, node: 0, displayId: 3031, frame: { x: 100, y: 200, z: 5, heading: Math.PI / 2 } };
const passenger = (guid: number, x: number) => ({
  guid, entry: 1, name: 'n', map: 591, x, y: 0, z: 1, orientation: 0, displayId: 1, scale: 1, wander: 0, path: null, equipment: [0, 0, 0] as [number, number, number], own: false, event: null, events: [], removedBy: [], pathId: 0, preset: null, group: null, respawnSecs: 300,
});
const answer = { creatures: [passenger(1, 2)], objects: [], capped: { creatures: false, objects: false } };

function build(source: any = vi.fn(async () => answer), now?: () => number) {
  const manager = new SpawnManager({
    resolver: { creature: async () => ({ kind: 'model', path: 'a.m2', textures: {}, geosets: null, scale: 1 }), object: async () => null } as any,
    createModel: async () => new THREE.Object3D(),
    createBuilding: async () => new THREE.Group(),
    source: null,
    frame: dock.frame,
    now,
  });
  return { manager, instance: createSpawnDock(dock, manager), source };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('a dock backed by a spawn manager', () => {
  it('asks the source for the transport map’s rows, whole grid, once it has a source, and draws them through the frame', async () => {
    const { instance, source } = build();
    instance.configure({ source: source as any });
    await settle();
    await settle();
    expect(source).toHaveBeenCalledWith(591, expect.objectContaining({ minX: expect.any(Number), maxX: expect.any(Number) }));
    const drawn = instance.find('creature', 1)!;
    expect(drawn).not.toBeNull();
    // local (2, 0, 1) turned a quarter turn about the dock at (100, 200, 5)
    expect(drawn.position.x).toBeCloseTo(100);
    expect(drawn.position.y).toBeCloseTo(202);
    expect(drawn.position.z).toBeCloseTo(6);
    expect(instance.picked('creature', 1)?.guid).toBe(1);
  });

  it('carries the vessel’s model group and the passengers under one root', async () => {
    const { instance, manager, source } = build();
    instance.configure({ source: source as any });
    await settle();
    await settle();
    expect(instance.root.children).toContain(manager.decor);
    expect(instance.root.children.some((c) => c.getObjectByName('creatures'))).toBe(true);
  });

  it('hands out the vessel’s group, for the deck to count as ground', () => {
    const { instance, manager } = build();
    expect(instance.decor).toBe(manager.decor);
  });

  it('applies visibility to its passengers', async () => {
    const { instance, source } = build();
    instance.configure({ source: source as any });
    await settle();
    await settle();
    instance.configure({ visibility: { creatures: false, objects: true, paths: false, events: 'none' } });
    await settle();
    expect(instance.root.getObjectByName('creatures')!.visible).toBe(false);
  });

  it('asks again for its passengers once a failed answer has aged, and says why meanwhile', async () => {
    let clock = 0;
    const source = vi.fn().mockResolvedValueOnce({ error: 'not connected' }).mockResolvedValue(answer);
    const { instance } = build(source, () => clock);
    instance.configure({ source });
    await settle();
    await settle();
    expect(instance.status.error).toBe('not connected');
    instance.update();
    await settle();
    expect(source).toHaveBeenCalledTimes(1);
    clock = 31000;
    instance.update();
    await settle();
    await settle();
    expect(source).toHaveBeenCalledTimes(2);
    expect(instance.find('creature', 1)).not.toBeNull();
    expect(instance.status.error).toBeNull();
    instance.update();
    await settle();
    expect(source).toHaveBeenCalledTimes(2);
  });

  it('does not ask before it has a source', async () => {
    const { instance } = build();
    instance.update();
    await settle();
    expect(instance.find('creature', 1)).toBeNull();
  });

  it('offers its drawn passengers to a selection box', async () => {
    const { instance, source } = build();
    instance.configure({ source: source as any });
    await settle();
    await settle();
    instance.cull(new THREE.Vector3(100, 202, 6));
    expect(instance.candidates(new THREE.Vector3(100, 202, 6)).map((c) => c.guid)).toEqual([1]);
  });

  it('draws nothing when disposed before the answer arrives, and frees what it drew', async () => {
    let release!: (v: typeof answer) => void;
    const slow = vi.fn(() => new Promise<typeof answer>((r) => (release = r)));
    const { instance } = build(slow as any);
    instance.configure({ source: slow as any });
    instance.dispose();
    release(answer);
    await settle();
    await settle();
    expect(instance.find('creature', 1)).toBeNull();
    expect(instance.root.children.some((c) => c.getObjectByName('creatures'))).toBe(false);
  });

  it('uses the area id the scene reserves for passengers', () => {
    expect(DOCK_AREA).toBe(-1);
  });
});
