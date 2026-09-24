import { describe, expect, it } from 'vitest';
import { ENTITIES_FIELD, newNpc, newObject, newSpawn, readEntities, writeEntities } from '../../src/core/entities/model';

describe('entity model', () => {
  it('round-trips entities and reads none from an old project', () => {
    const npc = { ...newNpc(12000001), name: 'Scout Hela', spawns: [newSpawn(6000001)] };
    const values = { [ENTITIES_FIELD]: writeEntities({ npcs: [npc], objects: [newObject(9100001)] }) };
    expect(readEntities(values)).toEqual({ npcs: [npc], objects: [newObject(9100001)] });
    expect(readEntities({})).toEqual({ npcs: [], objects: [] });
  });
  it('drops entries that are not valid', () => {
    const values = { [ENTITIES_FIELD]: { npcs: [newNpc(1), { entry: 'x' }], objects: 'nope' } as never };
    expect(readEntities(values)).toEqual({ npcs: [newNpc(1)], objects: [] });
  });
  it('starts new entities with sensible defaults', () => {
    expect(newNpc(5)).toMatchObject({ entry: 5, name: '', minLevel: 1, maxLevel: 1, faction: 35, scale: 1, rank: 'normal', type: 'humanoid', questGiver: false, gossip: false, healthModifier: 1, damageModifier: 1, spawns: [] });
    expect(newObject(6)).toMatchObject({ entry: 6, type: 'goober', size: 1, spawns: [] });
    expect(newSpawn(7)).toEqual({ guid: 7, map: 0, x: 0, y: 0, z: 0, o: 0, respawnSecs: 300, wander: 0 });
  });
});
