import { describe, expect, it } from 'vitest';
import { compileEntities } from '../../src/core/entities/compile';
import { EMPTY_ENTITY_CONTEXT } from '../../src/core/entities/context';
import { newNpc, newObject, newSpawn, type ProjectEntities } from '../../src/core/entities/model';

const npc = { ...newNpc(12000001), name: 'Hela', displayId: 1, spawns: [newSpawn(6000001)], loot: [{ item: 2589, chance: 50, min: 1, max: 2, questOnly: false }] };
const chest = { ...newObject(9100001), name: 'Crate', type: 'chest' as const, displayId: 259, onlyDuringQuest: 60002, spawns: [newSpawn(7000001)] };
const goober = { ...newObject(9100002), name: 'Lever', type: 'goober' as const, displayId: 1, onlyDuringQuest: 60003 };
const entities: ProjectEntities = { npcs: [npc], objects: [chest, goober], items: [] };
const compile = (over: Partial<Parameters<typeof compileEntities>[0]> = {}) => compileEntities({ entities, givers: [], context: EMPTY_ENTITY_CONTEXT, ...over });

describe('compileEntities for the project', () => {
  it('tags spawns and loot by entity', () => {
    const out = compile();
    expect(out.inserts.creature![0]!.Comment).toBe('AQC npc12000001 ');
    expect(out.inserts.gameobject![0]!.Comment).toBe('AQC obj9100001 ');
    expect(out.inserts.creature_loot_template![0]!.Comment).toBe('AQC npc12000001 loot');
  });

  it('writes the quest each object names for only-during-quest', () => {
    const out = compile();
    expect(out.inserts.gameobject_template!.find((r) => r.entry === '9100001')!.Data8).toBe('60002');
    expect(out.inserts.gameobject_template!.find((r) => r.entry === '9100002')!.Data1).toBe('60003');
  });

  it('flags an NPC any project quest starts or ends with as a quest giver', () => {
    expect(compile({ givers: [12000001] }).inserts.creature_template![0]!.npcflag).toBe('2');
  });

  it('leaves out a quest item\'s drops and names the quest that asks for it', () => {
    const out = compile({ questItems: [{ item: 2589, questId: 60004 }] });
    expect(out.inserts.creature_loot_template ?? []).toEqual([]);
    expect(out.warnings).toContain('NPC "Hela": item 2589 is one quest 60004 asks for, so its drops are set in that quest\'s Objectives, not in the loot list.');
  });

  it('deletes spawns and loot a past export wrote under a quest tag or the entity tag', () => {
    const out = compile({ context: { ...EMPTY_ENTITY_CONTEXT,
      taggedCreatureSpawns: [{ guid: '6000009', Comment: 'AQC q60001 npc12000001' }, { guid: '6000010', Comment: 'AQC npc12000001 ' }],
      taggedLoot: { creature: [{ Entry: '12000001', Item: '118', Comment: 'AQC q60001 loot' }, { Entry: '12000001', Item: '119', Comment: 'AQC npc12000001 loot' }], gameobject: [] } } });
    expect(out.deletes.creature).toEqual([{ guid: '6000001' }, { guid: '6000009' }, { guid: '6000010' }]);
    expect(out.deletes.creature_loot_template).toEqual([{ Entry: '12000001', Item: '118' }, { Entry: '12000001', Item: '119' }, { Entry: '12000001', Item: '2589' }]);
  });

  it('leaves rows of an entity the project does not have', () => {
    const out = compile({ entities: { npcs: [], objects: [], items: [] }, context: { ...EMPTY_ENTITY_CONTEXT, taggedCreatureSpawns: [{ guid: '6000009', Comment: 'AQC npc12000001 ' }] } });
    expect(out.deletes.creature).toBeUndefined();
  });
});
