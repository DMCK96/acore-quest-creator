// tests/core/entities-from-rows.test.ts
import { describe, expect, it } from 'vitest';
import { itemFromRows, npcFromRows, objectFromRows } from '../../src/core/entities/from-rows';

const counts = { sharedLoot: 0, spawnCount: 3 };
const guardRows = {
  creature_template: [{ entry: '1423', name: 'Stormwind Guard', subname: 'City Guard', minlevel: '55', maxlevel: '56', faction: '11', rank: '1', type: '7', npcflag: '3',
    HealthModifier: '1.5', DamageModifier: '1', AIName: '', ScriptName: '', lootid: '1423', unit_flags: '32768' }],
  creature_template_model: [{ CreatureID: '1423', Idx: '0', CreatureDisplayID: '3167', DisplayScale: '1.2', Probability: '1' }],
  creature_equip_template: [{ CreatureID: '1423', ID: '1', ItemID1: '1899', ItemID2: '143', ItemID3: '0' }],
  creature_loot_template: [
    { Entry: '1423', Item: '2589', Reference: '0', Chance: '35', QuestRequired: '0', LootMode: '1', GroupId: '0', MinCount: '1', MaxCount: '2', Comment: '' },
  ],
};

describe('an existing entity from its rows', () => {
  it('maps an NPC\'s template, model, weapons and loot to the editor\'s model, keeping the rows as its origin', () => {
    const npc = npcFromRows(1423, guardRows, counts);
    expect(npc).toMatchObject({
      entry: 1423, name: 'Stormwind Guard', subname: 'City Guard', minLevel: 55, maxLevel: 56, faction: 11, rank: 'elite', type: 'humanoid',
      questGiver: true, gossip: true, healthModifier: 1.5, damageModifier: 1, displayId: 3167, scale: 1.2,
      equipment: { mainHand: 1899, offHand: 143, ranged: 0 }, loot: [{ item: 2589, chance: 35, min: 1, max: 2, questOnly: false }],
      spawns: [], fight: null,
      origin: { kind: 'existing', original: guardRows, sharedLoot: 0, spawnCount: 3, locked: [] },
    });
  });

  it('locks the fight of an NPC the database already scripts, and loot lists with references or groups', () => {
    const scripted = { ...guardRows, creature_template: [{ ...guardRows.creature_template[0]!, AIName: 'SmartAI' }] };
    expect(npcFromRows(1423, scripted, counts).origin).toMatchObject({ locked: ['fight'] });
    const named = { ...guardRows, creature_template: [{ ...guardRows.creature_template[0]!, ScriptName: 'npc_guard' }] };
    expect(npcFromRows(1423, named, counts).origin).toMatchObject({ locked: ['fight'] });
    const grouped = { ...guardRows, creature_loot_template: [{ ...guardRows.creature_loot_template[0]!, GroupId: '1' }] };
    expect(npcFromRows(1423, grouped, counts)).toMatchObject({ loot: [], origin: { locked: ['loot'] } });
  });

  it('reads who sees the NPC from its flags', () => {
    const ghost = { ...guardRows, creature_template: [{ ...guardRows.creature_template[0]!, flags_extra: '1024', type_flags: '0' }] };
    expect(npcFromRows(1423, ghost, counts).seenBy).toBe('dead');
    expect(npcFromRows(1423, guardRows, counts).seenBy).toBe('living');
  });

  it('an NPC with no model or weapons rows reads as unarmed with no look', () => {
    const bare = npcFromRows(1423, { creature_template: guardRows.creature_template }, counts);
    expect(bare).toMatchObject({ displayId: 0, scale: 1, equipment: { mainHand: 0, offHand: 0, ranged: 0 }, loot: [] });
  });

  it('maps a chest with its loot and pages; locks a type the editor does not have', () => {
    const chest = {
      gameobject_template: [{ entry: '2843', type: '3', displayId: '259', name: 'Battered Chest', size: '1', Data1: '2843', AIName: '' }],
      gameobject_loot_template: [{ Entry: '2843', Item: '774', Reference: '0', Chance: '50', QuestRequired: '1', LootMode: '1', GroupId: '0', MinCount: '1', MaxCount: '1', Comment: '' }],
    };
    expect(objectFromRows(2843, chest, counts)).toMatchObject({ name: 'Battered Chest', type: 'chest', displayId: 259, size: 1, loot: [{ item: 774, chance: 50, questOnly: true }], spawns: [], origin: { locked: [] } });
    const mailbox = { gameobject_template: [{ entry: '143981', type: '19', displayId: '1949', name: 'Mailbox', size: '1' }] };
    expect(objectFromRows(143981, mailbox, counts)).toMatchObject({ name: 'Mailbox', origin: { locked: ['type'] } });
    const book = { gameobject_template: [{ entry: '700', type: '9', displayId: '1', name: 'Book', size: '1', Data0: '10' }], page_text: [{ ID: '10', Text: 'One', NextPageID: '11' }, { ID: '11', Text: 'Two', NextPageID: '0' }] };
    expect(objectFromRows(700, book, counts).pages).toEqual([{ id: 10, text: 'One' }, { id: 11, text: 'Two' }]);
  });

  it('maps an item through the item editor\'s own reader, keeping its other columns in advanced', () => {
    const item = itemFromRows(2589, { item_template: [{ entry: '2589', name: 'Linen Cloth', class: '7', subclass: '5', displayid: '7426', Quality: '1', holy_res: '0' }] });
    expect(item).toMatchObject({ entry: 2589, name: 'Linen Cloth', itemClass: 7, subclass: 5, displayId: 7426, origin: { kind: 'existing', locked: [] } });
    expect(item.advanced).toHaveProperty('holy_res', '0');
  });
});
