import { describe, expect, it } from 'vitest';
import { compileEntities } from '../../src/core/entities/compile';
import { EMPTY_ENTITY_CONTEXT } from '../../src/core/entities/context';
import { newNpc, newObject, newSpawn, type QuestEntities } from '../../src/core/entities/model';

const Q = 60001;
const npc = { ...newNpc(12000001), name: 'Scout Hela', subname: 'Pathfinder', minLevel: 10, maxLevel: 12, displayId: 1234, rank: 'elite' as const,
  spawns: [{ ...newSpawn(6000001), map: 0, x: 1.5, y: 2.5, z: 3.5, o: 1, wander: 5 }] };
const chest = { ...newObject(9100001), name: 'Old Chest', type: 'chest' as const, displayId: 259, spawns: [{ ...newSpawn(7000001), o: Math.PI }] };
const entities: QuestEntities = { npcs: [npc], objects: [chest] };
const compile = (over: Partial<Parameters<typeof compileEntities>[0]> = {}) =>
  compileEntities({ questId: Q, entities, givers: [], context: EMPTY_ENTITY_CONTEXT, ...over });

describe('compileEntities', () => {
  it('writes the NPC template, its model and its spawn', () => {
    const out = compile();
    expect(out.inserts.creature_template).toEqual([expect.objectContaining({
      entry: '12000001', name: 'Scout Hela', subname: 'Pathfinder', minlevel: '10', maxlevel: '12', faction: '35', npcflag: '0',
      rank: '1', type: '7', HealthModifier: '1', DamageModifier: '1', unit_class: '1', AIName: '', gossip_menu_id: '0',
    })]);
    expect(out.inserts.creature_template_model).toEqual([{ CreatureID: '12000001', Idx: '0', CreatureDisplayID: '1234', DisplayScale: '1', Probability: '1' }]);
    expect(out.inserts.creature).toEqual([expect.objectContaining({
      guid: '6000001', id1: '12000001', map: '0', spawnMask: '1', phaseMask: '1', position_x: '1.5', position_y: '2.5', position_z: '3.5',
      orientation: '1', spawntimesecs: '300', wander_distance: '5', MovementType: '1', Comment: 'AQC q60001 npc12000001',
    })]);
    expect(out.deletes.creature_template).toEqual([{ entry: '12000001' }]);
    expect(out.deletes.creature_template_model).toEqual([{ CreatureID: '12000001', Idx: '0' }]);
    expect(out.deletes.creature).toEqual([{ guid: '6000001' }]);
  });
  it('writes the object template and a spawn facing the right way', () => {
    const out = compile();
    expect(out.inserts.gameobject_template).toEqual([expect.objectContaining({ entry: '9100001', type: '3', displayId: '259', name: 'Old Chest', size: '1', Data1: '9100001', AIName: '' })]);
    const spawn = out.inserts.gameobject![0]!;
    expect(spawn).toMatchObject({ guid: '7000001', id: '9100001', state: '1', animprogress: '100', Comment: 'AQC q60001 obj9100001' });
    expect(Number(spawn.rotation2)).toBeCloseTo(1, 5);
    expect(Number(spawn.rotation3)).toBeCloseTo(0, 5);
  });
  it('makes an NPC that gives or takes the quest a quest giver', () => {
    expect(compile({ givers: [12000001] }).inserts.creature_template![0]!.npcflag).toBe('2');
    const flagged = compile({ entities: { npcs: [{ ...npc, gossip: true }], objects: [] } });
    expect(flagged.inserts.creature_template![0]!.npcflag).toBe('1');
  });
  it('keeps what quest scripting set on the template in the database', () => {
    const out = compile({ context: { ...EMPTY_ENTITY_CONTEXT, creatures: [{ entry: '12000001', AIName: 'SmartAI', gossip_menu_id: '90001', npcflag: '1' }],
      gameobjects: [{ entry: '9100001', AIName: 'SmartGameObjectAI' }] } });
    expect(out.inserts.creature_template![0]).toMatchObject({ AIName: 'SmartAI', gossip_menu_id: '90001', npcflag: '1' });
    expect(out.inserts.gameobject_template![0]).toMatchObject({ AIName: 'SmartGameObjectAI' });
  });
  it('leaves the spawns of an NPC the project no longer has, like its template', () => {
    const out = compile({ entities: { npcs: [], objects: [] }, context: { ...EMPTY_ENTITY_CONTEXT,
      taggedCreatureSpawns: [{ guid: '6000009', Comment: 'AQC q60001 npc12000001' }] } });
    expect(out.deletes.creature).toBeUndefined();
  });
  it('deletes spawns that were removed from the project', () => {
    const out = compile({ context: { ...EMPTY_ENTITY_CONTEXT,
      taggedCreatureSpawns: [{ guid: '6000009', Comment: 'AQC q60001 npc12000001' }, { guid: '6000001', Comment: 'AQC q60001 npc12000001' }],
      taggedObjectSpawns: [{ guid: '7000009', Comment: 'AQC q60001 obj9100001' }] } });
    expect(out.deletes.creature).toEqual([{ guid: '6000001' }, { guid: '6000009' }]);
    expect(out.deletes.gameobject).toEqual([{ guid: '7000001' }, { guid: '7000009' }]);
  });
});
