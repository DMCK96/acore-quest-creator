import { describe, expect, it } from 'vitest';
import { newNpc, newObject, newSpawn, readProjectEntities } from '../../../src/core/entities/model';
import { placeSpawn } from '../../../src/core/map/positions';
import { newPatrolPoint } from '../../../src/core/map/patrol';

const values = () => ({
  npcs: [{ ...newNpc(12000001), spawns: [{ ...newSpawn(900), x: 1, y: 1, z: 1 }] }],
  objects: [{ ...newObject(13000001), spawns: [{ ...newSpawn(901), x: 2, y: 2, z: 2 }] }],
  items: [],
});

describe('placing an own spawn from the 3D view', () => {
  it('moves and turns an NPC, ignoring a rotation', () => {
    const edit = placeSpawn(values(), 'spawn:npc:12000001:900', { x: 5, y: 6, z: 7, orientation: 1.5, rotation: [0, 0, 1, 0] })!;
    const spawn = edit.npcs[0]!.spawns[0]!;
    expect(spawn).toMatchObject({ x: 5, y: 6, z: 7, o: 1.5, rotation: null });
  });

  it('moves, turns and tilts an object', () => {
    const edit = placeSpawn(values(), 'spawn:obj:13000001:901', { x: 5, y: 6, z: 7, orientation: 0.3, rotation: [0.1, 0.2, 0.3, 0.9] })!;
    const spawn = edit.objects[0]!.spawns[0]!;
    expect(spawn).toMatchObject({ x: 5, y: 6, z: 7, o: 0.3, rotation: [0.1, 0.2, 0.3, 0.9] });
  });

  it('gives nothing for a spawn that is not the quest\'s', () => {
    expect(placeSpawn(values(), 'spawn:npc:12000001:999', { x: 0, y: 0, z: 0, orientation: 0, rotation: null })).toBeNull();
  });

  it('makes a new patrol point that does not wait', () => {
    expect(newPatrolPoint({ x: 1, y: 2, z: 3 })).toEqual({ x: 1, y: 2, z: 3, waitSecs: 0, facing: null, paceFromHere: null, actions: [] });
  });

  it('reads a spawn saved before tilt with no rotation', () => {
    const raw = JSON.parse(JSON.stringify(values()));
    delete raw.objects[0].spawns[0].rotation;
    expect(readProjectEntities(raw).objects[0]!.spawns[0]!.rotation).toBeNull();
  });
});
