// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import SpawnManager from '../../src/renderer/world3d/scene/spawn/SpawnManager';

const creature = (guid: number, displayId: number, extra: object = {}) => ({
  guid, entry: 1, name: 'n', map: 0, x: 0, y: 0, z: 0, orientation: 0, displayId, scale: 1, wander: 0, path: null, equipment: [0, 0, 0] as [number, number, number], own: false, ...extra,
});
const object = (guid: number, displayId: number) => ({ guid, entry: 2, name: 'o', map: 0, x: 0, y: 0, z: 0, rotation: [0, 0, 0, 1] as [number, number, number, number], displayId, scale: 1, own: false });
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
    m.setVisibility({ creatures: false, objects: true, paths: false });
    expect(group.getObjectByName('creatures')!.visible).toBe(false);
    expect(group.getObjectByName('objects')!.visible).toBe(true);
    expect(group.getObjectByName('paths')!.visible).toBe(false);
    expect(group.getObjectByName('creatures')!.children).toHaveLength(1);
  });
});

describe('how far spawns are drawn', () => {
  it('hides spawns beyond the draw distance from the camera, and shows them again within it', async () => {
    const m = manager({ creatures: [creature(1, 1, { x: 50 }), creature(2, 1, { x: 400 })], objects: [object(3, 2)], capped: { creatures: false, objects: false } });
    const group = (await m.loadArea(1, 0, box))!;
    const [near, far] = group.getObjectByName('creatures')!.children;
    m.cull(new THREE.Vector3(0, 0, 0));
    expect([near!.visible, far!.visible]).toEqual([true, false]);
    m.cull(new THREE.Vector3(390, 0, 0));
    expect([near!.visible, far!.visible]).toEqual([false, true]);
  });
});

describe('how far routes are drawn', () => {
  it('hides an NPC\'s route and wander circle with the NPC, beyond the draw distance', async () => {
    const m = manager({
      creatures: [creature(1, 1, { x: 400, wander: 5 }), creature(2, 1, { x: 400, path: [{ x: 410, y: 0, z: 0 }] }), creature(3, 1, { x: 20, wander: 5 })],
      objects: [], capped: { creatures: false, objects: false },
    });
    const group = (await m.loadArea(1, 0, box))!;
    m.cull(new THREE.Vector3(0, 0, 0));
    const shown = group.getObjectByName('paths')!.children.map((p) => p.visible);
    expect(shown).toEqual([false, false, true]);
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
