import { describe, expect, it } from 'vitest';
import { ENTITIES_FIELD, newNpc, newObject, newSpawn, readEntities, readProjectEntities, writeEntities } from '../../src/core/entities/model';

describe('entity model', () => {
  it('round-trips entities and reads none from an old project', () => {
    const npc = { ...newNpc(12000001), name: 'Scout Hela', spawns: [newSpawn(6000001)] };
    const values = { [ENTITIES_FIELD]: writeEntities({ npcs: [npc], objects: [newObject(9100001)], items: [] }) };
    expect(readEntities(values)).toEqual({ npcs: [npc], objects: [newObject(9100001)], items: [] });
    expect(readEntities({})).toEqual({ npcs: [], objects: [], items: [] });
  });
  it('drops entries that are not valid', () => {
    const values = { [ENTITIES_FIELD]: { npcs: [newNpc(1), { entry: 'x' }], objects: 'nope' } as never };
    expect(readEntities(values)).toEqual({ npcs: [newNpc(1)], objects: [], items: [] });
  });
  it('starts new entities with sensible defaults', () => {
    expect(newNpc(5)).toMatchObject({ entry: 5, name: '', minLevel: 1, maxLevel: 1, faction: 35, scale: 1, rank: 'normal', type: 'humanoid', questGiver: false, gossip: false, healthModifier: 1, damageModifier: 1, spawns: [] });
    expect(newObject(6)).toMatchObject({ entry: 6, type: 'goober', size: 1, spawns: [] });
    expect(newSpawn(7)).toEqual({ guid: 7, map: 0, x: 0, y: 0, z: 0, o: 0, respawnSecs: 300, wander: 0, patrol: null, rotation: null, events: 'npc' });
  });
  it('reads spawns saved before patrols as not patrolling, and keeps a saved patrol', () => {
    const old = { guid: 1, map: 0, x: 0, y: 0, z: 0, o: 0, respawnSecs: 300, wander: 0 };
    const patrol = { pathId: 10, startPace: 'run', points: [{ x: 1, y: 2, z: 3, waitSecs: 0, facing: null, paceFromHere: null, actions: [{ id: 'a1', afterSecs: 0, kind: 'dismount' }] }] };
    const values = { [ENTITIES_FIELD]: { npcs: [{ ...newNpc(5), spawns: [old, { ...old, guid: 2, patrol }] }], objects: [] } };
    const spawns = readEntities(values).npcs[0]!.spawns;
    expect(spawns[0]!.patrol).toBeNull();
    expect(spawns[1]!.patrol).toEqual(patrol);
  });
});

describe('NPC visibility fields', () => {
  it('a new NPC is seen by the living and always in the world; a new spawn follows its NPC', () => {
    expect(newNpc(12000001)).toMatchObject({ seenBy: 'living', events: null });
    expect(newSpawn(6000001).events).toBe('npc');
  });

  it('an NPC saved before visibility existed keeps the database as it is', () => {
    const saved = { ...newNpc(12000001), spawns: [{ ...newSpawn(6000001) }] } as Record<string, unknown>;
    delete saved.seenBy;
    delete saved.events;
    delete (saved.spawns as Record<string, unknown>[])[0]!.events;
    const [npc] = readProjectEntities({ npcs: [saved], objects: [], items: [] }).npcs;
    expect(npc!.seenBy).toBeUndefined();
    expect(npc!.events).toBe('asIs');
    expect(npc!.spawns[0]!.events).toBe('npc');
  });

  it('keeps a rule with several events and refuses one with none', () => {
    const during = { ...newNpc(1), events: { mode: 'during', events: [12, 4] } };
    expect(readProjectEntities({ npcs: [during], objects: [], items: [] }).npcs[0]!.events).toEqual({ mode: 'during', events: [12, 4] });
    const empty = { ...newNpc(1), events: { mode: 'except', events: [] } };
    expect(readProjectEntities({ npcs: [empty], objects: [], items: [] }).npcs).toEqual([]);
  });
});
