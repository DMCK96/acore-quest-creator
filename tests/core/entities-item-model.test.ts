import { describe, expect, it } from 'vitest';
import { ENTITIES_FIELD, newItem, newNpc, readEntities, writeEntities } from '../../src/core/entities/model';

describe('custom items in the entity model', () => {
  it('starts a new item as a quest item', () => {
    expect(newItem(990001)).toEqual({
      entry: 990001, name: '', description: '', quality: 'common', itemClass: 12, subclass: 0, inventoryType: 0, displayId: 0,
      itemLevel: 1, requiredLevel: 0, stackable: 1, maxCount: 1, bonding: 'quest', buyPrice: 0, sellPrice: 0, startsQuest: 0,
      pages: [], armor: 0, damage: [], delayMs: 0, stats: [], spells: [], advanced: {},
    });
  });
  it('round-trips items and reads none from a project saved before items', () => {
    const item = { ...newItem(990001), name: 'Pearl', stats: [{ type: 7, value: 12 }], advanced: { holy_res: '5' } };
    const values = { [ENTITIES_FIELD]: writeEntities({ npcs: [], objects: [], items: [item] }) };
    expect(readEntities(values).items).toEqual([item]);
    expect(readEntities({ [ENTITIES_FIELD]: { npcs: [newNpc(1)], objects: [] } as never }).items).toEqual([]);
  });
  it('drops items that are not valid, including too many stats, damage rows or spells', () => {
    const tooMany = { ...newItem(2), stats: Array.from({ length: 11 }, () => ({ type: 7, value: 1 })) };
    const twoMuchDamage = { ...newItem(3), damage: [1, 2, 3].map(() => ({ min: 1, max: 2, school: 0 })) };
    const sixSpells = { ...newItem(4), spells: Array.from({ length: 6 }, () => ({ spell: 1, trigger: 0, charges: 0, cooldownMs: 0, category: 0, categoryCooldownMs: 0 })) };
    const values = { [ENTITIES_FIELD]: { npcs: [], objects: [], items: [newItem(1), { entry: 'x' }, tooMany, twoMuchDamage, sixSpells] } as never };
    expect(readEntities(values).items).toEqual([newItem(1)]);
  });
});
