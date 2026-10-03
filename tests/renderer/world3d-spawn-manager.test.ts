// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { WorldLayer } from '../../src/core/world/layer';
import SpawnManager from '../../src/renderer/world3d/scene/spawn/SpawnManager';

const creature = (guid: number, displayId: number, extra: object = {}) => ({
  guid, entry: 1, name: 'n', map: 0, x: 0, y: 0, z: 0, orientation: 0, displayId, scale: 1, wander: 0, path: null, equipment: [0, 0, 0] as [number, number, number], own: false, event: null, pathId: 0, preset: null, ...extra,
});
const object = (guid: number, displayId: number, extra: object = {}) => ({
  guid, entry: 2, name: 'o', map: 0, x: 0, y: 0, z: 0, rotation: [0, 0, 0, 1] as [number, number, number, number], displayId, scale: 1, own: false, event: null, ...extra,
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
    m.setVisibility({ creatures: false, objects: true, paths: false, events: false });
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

describe('which routes are drawn', () => {
  it('draws only the route and wander circle of the selected NPC, however far away it is', async () => {
    const m = manager({
      creatures: [creature(1, 1, { x: 400, wander: 5 }), creature(2, 1, { x: 400, path: [{ x: 410, y: 0, z: 0 }] }), creature(3, 1, { x: 20, wander: 5 })],
      objects: [], capped: { creatures: false, objects: false },
    });
    const group = (await m.loadArea(1, 0, box))!;
    const shown = () => group.getObjectByName('paths')!.children.map((p) => p.visible);
    m.cull(new THREE.Vector3(0, 0, 0));
    expect(shown()).toEqual([false, false, false]);
    m.setSelected({ kind: 'creature', guid: 2 });
    m.cull(new THREE.Vector3(0, 0, 0));
    expect(shown()).toEqual([false, true, false]);
    m.setSelected({ kind: 'object', guid: 2 });
    m.cull(new THREE.Vector3(0, 0, 0));
    expect(shown()).toEqual([false, false, false]);
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

describe('the final review\'s findings', () => {
  const disposable = () => {
    const model = new THREE.Object3D() as THREE.Object3D & { dispose: ReturnType<typeof vi.fn> };
    model.dispose = vi.fn();
    return model;
  };

  it('frees the models of an area it drops, and of an area it redraws', async () => {
    const made: ReturnType<typeof disposable>[] = [];
    const m = manager({ creatures: [creature(1, 1), creature(2, 1)], objects: [], capped: { creatures: false, objects: false } }, {
      createModel: async () => { const d = disposable(); made.push(d); return d; },
    });
    await m.loadArea(1, 0, box);
    await m.setOwnSpawns({ creatures: [], objects: [], capped: { creatures: false, objects: false } });
    // The redraw freed the first two models and made two more
    expect(made).toHaveLength(4);
    expect(made.slice(0, 2).every((d) => d.dispose.mock.calls.length === 1)).toBe(true);
    m.removeArea(1);
    expect(made.slice(2).every((d) => d.dispose.mock.calls.length === 1)).toBe(true);
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

  it('leaves out spawns that appear only during a game event, and draws them once asked for', async () => {
    const m = manager({ creatures: [creature(1, 1), creature(2, 1, { event: holiday })], objects: [object(3, 2, { event: holiday })], capped: { creatures: false, objects: false } });
    const group = (await m.loadArea(1, 0, box))!;
    const guids = () => [...group.getObjectByName('creatures')!.children, ...group.getObjectByName('objects')!.children].map((c) => c.userData.spawn.guid);
    expect(guids()).toEqual([1]);
    await m.setVisibility({ creatures: true, objects: true, paths: true, events: true });
    expect(guids()).toEqual([1, 2, 3]);
    await m.setVisibility({ creatures: true, objects: true, paths: true, events: false });
    expect(guids()).toEqual([1]);
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
    m.setVisibility({ creatures: false, objects: true, paths: true, events: false });
    expect(m.pick(ray())).toBeNull();
  });

  it('passes over a spawn the ray starts inside', async () => {
    const m = await marker([creature(1, 0, { x: 0 }), creature(2, 0, { x: 10 })]);
    expect(m.pick(ray(0))?.guid).toBe(2);
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

  it('picks a route point of the selected NPC by its ball', async () => {
    const m = manager({ creatures: [creature(2, 0, { pathId: 77, path: [{ x: 10, y: 0, z: 1 }, { x: 20, y: 0, z: 1 }] })], objects: [], capped: { creatures: false, objects: false } });
    await m.loadArea(1, 0, box);
    m.setSelected({ kind: 'creature', guid: 2 });
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
