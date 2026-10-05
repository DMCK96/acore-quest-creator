import { describe, expect, it } from 'vitest';
import { newNpc, newObject, newSpawn } from '../../../src/core/entities/model';
import { ownViewSpawns } from '../../../src/core/entities/view-spawns';

describe('the open quest\'s own spawns for the 3D view', () => {
  it('turns a new NPC\'s spawns into view creatures, with its look, weapons, wander and route', () => {
    const npc = { ...newNpc(900100), name: 'Dock Worker', displayId: 3167, scale: 1.2, equipment: { mainHand: 1899, offHand: 0, ranged: 0 } };
    const standing = { ...newSpawn(800001), map: 0, x: 1, y: 2, z: 3, o: 0.5, wander: 4 };
    const walking = { ...newSpawn(800002), map: 0, x: 5, y: 6, z: 7, o: 0, wander: 0,
      patrol: { pathId: 8000020, startPace: 'walk' as const, points: [{ x: 6, y: 6, z: 7, waitSecs: 0, facing: null, paceFromHere: null, actions: [] }] } };
    const out = ownViewSpawns({ npcs: [{ ...npc, spawns: [standing, walking] }], objects: [] });
    expect(out.creatures).toEqual([
      { guid: 800001, entry: 900100, name: 'Dock Worker', map: 0, x: 1, y: 2, z: 3, orientation: 0.5, displayId: 3167, scale: 1.2, wander: 4, path: null, equipment: [1899, 0, 0], own: true, event: null, events: [], removedBy: [], pathId: 0, preset: null, respawnSecs: 300 },
      { guid: 800002, entry: 900100, name: 'Dock Worker', map: 0, x: 5, y: 6, z: 7, orientation: 0, displayId: 3167, scale: 1.2, wander: 0, path: [{ x: 6, y: 6, z: 7, carry: walking.patrol.points[0] }], equipment: [1899, 0, 0], own: true, event: null, events: [], removedBy: [], pathId: 8000020, preset: null, respawnSecs: 300 },
    ]);
    expect(out.capped).toEqual({ creatures: false, objects: false });
  });

  it('turns a new object\'s spawns into view objects, turned by their facing', () => {
    const chest = { ...newObject(900200), name: 'Old Chest', displayId: 259, size: 1.5, spawns: [{ ...newSpawn(800010), map: 0, x: 1, y: 1, z: 1, o: Math.PI }] };
    const [o] = ownViewSpawns({ npcs: [], objects: [chest] }).objects;
    expect(o).toMatchObject({ guid: 800010, entry: 900200, name: 'Old Chest', displayId: 259, scale: 1.5, own: true });
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
