// tests/core/entities-equipment.test.ts
import { describe, expect, it } from 'vitest';
import { compileEntities } from '../../src/core/entities/compile';
import { EMPTY_ENTITY_CONTEXT } from '../../src/core/entities/context';
import { newNpc, newSpawn, readEntities, ENTITIES_FIELD } from '../../src/core/entities/model';

const armed = { ...newNpc(12000001), name: 'Guard', displayId: 3167, equipment: { mainHand: 1899, offHand: 143, ranged: 0 }, spawns: [newSpawn(900)] };
const compile = (npc = armed) => compileEntities({ questId: 60001, entities: { npcs: [npc], objects: [] }, givers: [], context: EMPTY_ENTITY_CONTEXT });

describe('NPC weapons', () => {
  it('starts unarmed, and reads NPCs saved before weapons as unarmed', () => {
    expect(newNpc(1).equipment).toEqual({ mainHand: 0, offHand: 0, ranged: 0 });
    const { equipment: _, ...old } = newNpc(2);
    expect(readEntities({ [ENTITIES_FIELD]: { npcs: [old], objects: [] } }).npcs[0]!.equipment).toEqual({ mainHand: 0, offHand: 0, ranged: 0 });
  });
  it('writes its weapons and makes its spawns hold them', () => {
    const out = compile();
    expect(out.inserts.creature_equip_template).toEqual([{ CreatureID: '12000001', ID: '1', ItemID1: '1899', ItemID2: '143', ItemID3: '0' }]);
    expect(out.inserts.creature![0]!.equipment_id).toBe('1');
    expect(out.deletes.creature_equip_template).toEqual([{ CreatureID: '12000001', ID: '1' }]);
  });
  it('writes no weapons for an unarmed NPC but still clears old ones', () => {
    const out = compile({ ...armed, equipment: { mainHand: 0, offHand: 0, ranged: 0 } });
    expect(out.inserts.creature_equip_template).toBeUndefined();
    expect(out.inserts.creature![0]!.equipment_id).toBe('0');
    expect(out.deletes.creature_equip_template).toEqual([{ CreatureID: '12000001', ID: '1' }]);
  });
});
