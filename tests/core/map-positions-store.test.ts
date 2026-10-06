import { describe, expect, it } from 'vitest';
import { addSpawn, moveMarker, placeSpawn, questMarkers, removeSpawn, setSpawnMovement } from '../../src/core/map/positions';
import { patrolOf, setPatrol, newPatrol, addPoint } from '../../src/core/map/patrol';
import { EMPTY_ENTITIES, newNpc, newSpawn } from '../../src/core/entities/model';
import { SCRIPTS_FIELD } from '../../src/core/scripts/model';

const store = { ...EMPTY_ENTITIES, npcs: [{ ...newNpc(12000001), name: 'Hela', spawns: [newSpawn(6000001)] }] };

describe('map helpers over the project store', () => {
  it('place, add and remove spawns return the next store', () => {
    const placed = placeSpawn(store, 'spawn:npc:12000001:6000001', { x: 1, y: 2, z: 3, orientation: 0.5, rotation: null })!;
    expect(placed.npcs[0]!.spawns[0]).toMatchObject({ x: 1, y: 2, z: 3, o: 0.5 });
    const added = addSpawn(store, { kind: 'npc', entry: 12000001 }, { guid: 6000002, map: 0, x: 4, y: 5, z: 6, o: 0 })!;
    expect(added.npcs[0]!.spawns.map((s) => s.guid)).toEqual([6000001, 6000002]);
    expect(removeSpawn(added, { kind: 'npc', entry: 12000001 }, 6000001)!.npcs[0]!.spawns.map((s) => s.guid)).toEqual([6000002]);
    expect(store.npcs[0]!.spawns).toHaveLength(1);
    expect(setSpawnMovement(store, 12000001, 6000001, { type: 'wander', wander: 5, pathId: null })!.npcs[0]!.spawns[0]!.wander).toBe(5);
  });

  it('patrols are read and set on the store', () => {
    const next = setPatrol(store, 12000001, 6000001, addPoint(newPatrol(60000010), { x: 9, y: 9, z: 0 }))!;
    expect(patrolOf(next, 12000001, 6000001)!.pathId).toBe(60000010);
  });

  it('markers come from the quest\'s values and the NPCs it uses; a moved spawn changes the store, a moved scene point the quest', () => {
    const values = { [SCRIPTS_FIELD]: [{ id: 's1', name: 'Walk', owner: { kind: 'creature', entry: 12000001 }, trigger: { kind: 'dies' }, gates: [],
      steps: [{ kind: 'moveTo', at: { x: 1, y: 1, z: 1, o: 0 }, waitMs: 0 }] }] };
    expect(questMarkers(values, store).map((m) => m.id)).toEqual(['scene:s1:0:at']);
    const sceneMove = moveMarker(values, store, 'scene:s1:0:at', { x: 3, y: 3, z: 3 });
    expect(sceneMove).toMatchObject({ field: SCRIPTS_FIELD });
  });
});
