import { describe, expect, it } from 'vitest';
import { newNpc, newObject, newSpawn } from '../../../src/core/entities/model';
import { looksOf, ownViewSpawns, withLooks } from '../../../src/core/entities/view-spawns';

describe('the open quest\'s own spawns for the 3D view', () => {
  it('turns a new NPC\'s spawns into view creatures, with its look, weapons, wander and route', () => {
    const npc = { ...newNpc(900100), name: 'Dock Worker', displayId: 3167, scale: 1.2, equipment: { mainHand: 1899, offHand: 0, ranged: 0 } };
    const standing = { ...newSpawn(800001), map: 0, x: 1, y: 2, z: 3, o: 0.5, wander: 4 };
    const walking = { ...newSpawn(800002), map: 0, x: 5, y: 6, z: 7, o: 0, wander: 0,
      patrol: { pathId: 8000020, startPace: 'walk' as const, points: [{ x: 6, y: 6, z: 7, waitSecs: 0, facing: null, paceFromHere: null, actions: [] }] } };
    const out = ownViewSpawns({ npcs: [{ ...npc, spawns: [standing, walking] }], objects: [] });
    expect(out.creatures).toEqual([
      { guid: 800001, entry: 900100, name: 'Dock Worker', map: 0, x: 1, y: 2, z: 3, orientation: 0.5, displayId: 3167, scale: 1.2, wander: 4, path: null, equipment: [1899, 0, 0], own: true, event: null, events: [], removedBy: [], pathId: 0, preset: null, group: null, respawnSecs: 300  },
      { guid: 800002, entry: 900100, name: 'Dock Worker', map: 0, x: 5, y: 6, z: 7, orientation: 0, displayId: 3167, scale: 1.2, wander: 0, path: [{ x: 6, y: 6, z: 7, carry: walking.patrol.points[0] }], equipment: [1899, 0, 0], own: true, event: null, events: [], removedBy: [], pathId: 8000020, preset: null, group: null, respawnSecs: 300  },
    ]);
    expect(out.capped).toEqual({ creatures: false, objects: false });
  });

  it('turns a new object\'s spawns into view objects, turned by their facing', () => {
    const chest = { ...newObject(900200), name: 'Old Chest', displayId: 259, size: 1.5, spawns: [{ ...newSpawn(800010), map: 0, x: 1, y: 1, z: 1, o: Math.PI }] };
    const [o] = ownViewSpawns({ npcs: [], objects: [chest] }).objects;
    expect(o).toMatchObject({ guid: 800010, entry: 900200, name: 'Old Chest', displayId: 259, scale: 1.5, own: true, objectType: 10 });
    expect(ownViewSpawns({ npcs: [], objects: [{ ...chest, type: 'chest' }] }).objects[0]!.objectType).toBe(3);
    expect(o!.rotation[2]).toBeCloseTo(1, 6);
    expect(o!.rotation[3]).toBeCloseTo(0, 6);
  });

  it('gives each spawn its respawn time', () => {
    const npc = { ...newNpc(900100), spawns: [{ ...newSpawn(800001), respawnSecs: 60 }] };
    const chest = { ...newObject(900200), spawns: [{ ...newSpawn(800010), respawnSecs: 45 }] };
    const out = ownViewSpawns({ npcs: [npc], objects: [chest] });
    expect(out.creatures[0]!.respawnSecs).toBe(60);
    expect(out.objects[0]!.respawnSecs).toBe(45);
  });
});

describe('edited looks', () => {
  it('draws database spawns of an edited existing entity with its new look, and leaves others alone', () => {
    const origin = { kind: 'existing' as const, original: {}, sharedLoot: 0, spawnCount: 2, locked: [] } as any;
    const store = { npcs: [{ ...newNpc(1423), displayId: 4000, scale: 2, equipment: { mainHand: 1899, offHand: 0, ranged: 0 }, origin }, newNpc(12000001)], objects: [{ ...newObject(143981), displayId: 9, size: 3, origin }], items: [] };
    const looks = looksOf(store);
    expect([...looks.keys()]).toEqual(['creature:1423', 'object:143981']);
    const spawns = {
      creatures: [{ guid: 1, entry: 1423, displayId: 3167, scale: 1, equipment: [0, 0, 0] }, { guid: 2, entry: 68, displayId: 5, scale: 1, equipment: [0, 0, 0] }],
      objects: [{ guid: 3, entry: 143981, displayId: 1949, scale: 1 }],
      capped: { creatures: false, objects: false },
    } as any;
    const drawn = withLooks(spawns, looks);
    expect(drawn.creatures.map((c: any) => [c.displayId, c.scale, c.equipment])).toEqual([[4000, 2, [1899, 0, 0]], [5, 1, [0, 0, 0]]]);
    expect(drawn.objects[0]).toMatchObject({ displayId: 9, scale: 3 });
  });
});
