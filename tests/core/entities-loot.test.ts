import { describe, expect, it } from 'vitest';
import { compileEntities } from '../../src/core/entities/compile';
import { EMPTY_ENTITY_CONTEXT } from '../../src/core/entities/context';
import { ENTITIES_FIELD, newNpc, newObject, readEntities } from '../../src/core/entities/model';
import { entityIssues } from '../../src/core/entities/validate';

const Q = 60001;
const chest = { ...newObject(9100001), type: 'chest' as const, name: 'Chest', displayId: 1, loot: [{ item: 2589, chance: 50, min: 1, max: 3, questOnly: false }, { item: 750, chance: 100, min: 1, max: 1, questOnly: true }] };
const npc = { ...newNpc(12000001), name: 'Hela', displayId: 1, loot: [{ item: 117, chance: 25, min: 1, max: 2, questOnly: false }] };
const compile = (over: Partial<Parameters<typeof compileEntities>[0]> = {}) =>
  compileEntities({ questId: Q, entities: { npcs: [npc], objects: [chest] }, givers: [], questItems: [750], context: EMPTY_ENTITY_CONTEXT, ...over });

describe('loot', () => {
  it('reads entities saved before loot existed', () => {
    const e = readEntities({ [ENTITIES_FIELD]: { npcs: [{ ...newNpc(1), loot: undefined }], objects: [{ ...newObject(2), loot: undefined }] } as never });
    expect(e.npcs[0]!.loot).toEqual([]);
    expect(e.objects[0]!.loot).toEqual([]);
  });
  it('writes chest and NPC loot, tagged, and skips items the quest requires', () => {
    const out = compile();
    expect(out.inserts.gameobject_loot_template).toEqual([
      { Entry: '9100001', Item: '2589', Reference: '0', Chance: '50', QuestRequired: '0', LootMode: '1', GroupId: '0', MinCount: '1', MaxCount: '3', Comment: 'AQC q60001 loot' },
    ]);
    expect(out.inserts.creature_loot_template).toEqual([
      { Entry: '12000001', Item: '117', Reference: '0', Chance: '25', QuestRequired: '0', LootMode: '1', GroupId: '0', MinCount: '1', MaxCount: '2', Comment: 'AQC q60001 loot' },
    ]);
    expect(out.inserts.creature_template![0]).toMatchObject({ lootid: '12000001' });
    expect(out.warnings.some((w) => /750/.test(w))).toBe(true);
  });
  it('leaves lootid at 0 for an NPC without loot and skips loot on objects that are not chests', () => {
    const out = compile({ entities: { npcs: [{ ...npc, loot: [] }], objects: [{ ...chest, type: 'goober' }] } });
    expect(out.inserts.creature_template![0]!.lootid ?? '0').toBe('0');
    expect(out.inserts.gameobject_loot_template).toBeUndefined();
    expect(out.warnings.some((w) => /only a chest/i.test(w))).toBe(true);
  });
  it('deletes its current rows and tagged rows it no longer has, for entities still in the project', () => {
    const out = compile({ context: { ...EMPTY_ENTITY_CONTEXT, taggedLoot: {
      creature: [{ Entry: '12000001', Item: '999', Comment: 'AQC q60001 loot' }, { Entry: '55', Item: '1', Comment: 'AQC q60001 loot' }],
      gameobject: [] } } });
    expect(out.deletes.creature_loot_template).toEqual([{ Entry: '12000001', Item: '117' }, { Entry: '12000001', Item: '999' }]);
    expect(out.deletes.gameobject_loot_template).toEqual([{ Entry: '9100001', Item: '2589' }]);
  });
  it('validates loot rows', () => {
    const codes = (loot: unknown[], type: 'chest' | 'goober' = 'chest') => entityIssues({
      entities: { npcs: [], objects: [{ ...newObject(9), type, name: 'C', displayId: 1, loot: loot as never, spawns: [{ guid: 1, map: 0, x: 1, y: 0, z: 0, o: 0, respawnSecs: 1, wander: 0, patrol: null }] }] },
      dbNames: new Map(), questItems: [750],
    }).map((i) => i.code);
    expect(codes([])).toEqual(['LOOT_EMPTY_CHEST']);
    expect(codes([{ item: 1, chance: 101, min: 1, max: 1, questOnly: false }])).toEqual(['LOOT_CHANCE']);
    expect(codes([{ item: 1, chance: 5, min: 3, max: 2, questOnly: false }])).toEqual(['LOOT_COUNT']);
    expect(codes([{ item: 0, chance: 5, min: 1, max: 1, questOnly: false }])).toEqual(['LOOT_NO_ITEM']);
    expect(codes([{ item: 750, chance: 5, min: 1, max: 1, questOnly: false }])).toEqual(['LOOT_QUEST_ITEM']);
  });
});
