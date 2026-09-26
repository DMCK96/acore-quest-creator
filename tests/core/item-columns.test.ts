import { describe, expect, it } from 'vitest';
import { newItem } from '../../src/core/entities/model';
import { advancedColumnGroups, advancedGroupOf, itemFromRow, itemRow, MODELLED_ITEM_COLUMNS } from '../../src/core/entities/item-columns';
import { statLabel } from '../../src/core/entities/item-vocab';
import type { ColumnInfo } from '../../src/core/db/types';

const sword = {
  ...newItem(990010), name: 'Pearl Blade', description: 'Shiny.', quality: 'rare' as const, itemClass: 2, subclass: 7, inventoryType: 13,
  displayId: 20000, itemLevel: 115, requiredLevel: 68, stackable: 1, maxCount: 0, bonding: 'pickup' as const, buyPrice: 100, sellPrice: 25,
  armor: 0, damage: [{ min: 100, max: 180, school: 0 }, { min: 5, max: 10, school: 2 }], delayMs: 2600,
  stats: [{ type: 7, value: 20 }, { type: 4, value: 15 }],
  spells: [{ spell: 18384, trigger: 1, charges: 0, cooldownMs: -1, category: 0, categoryCooldownMs: -1 }],
  advanced: { fire_res: '10', RequiredSkill: '43' },
};

describe('item columns', () => {
  it('writes a typed item as an item_template row', () => {
    const row = itemRow(sword);
    expect(row).toMatchObject({
      entry: '990010', name: 'Pearl Blade', description: 'Shiny.', Quality: '3', class: '2', subclass: '7', InventoryType: '13',
      displayid: '20000', ItemLevel: '115', RequiredLevel: '68', stackable: '1', maxcount: '0', bonding: '1', BuyPrice: '100', SellPrice: '25',
      startquest: '0', PageText: '0', armor: '0', delay: '2600', StatsCount: '2', stat_type1: '7', stat_value1: '20', stat_type2: '4', stat_value2: '15',
      stat_type3: '0', stat_value10: '0', dmg_min1: '100', dmg_max1: '180', dmg_type1: '0', dmg_min2: '5', dmg_max2: '10', dmg_type2: '2',
      spellid_1: '18384', spelltrigger_1: '1', spellcharges_1: '0', spellcooldown_1: '-1', spellcategory_1: '0', spellcategorycooldown_1: '-1',
      spellid_2: '0', spellid_5: '0', fire_res: '10', RequiredSkill: '43',
    });
  });
  it('puts the first page in PageText', () => {
    expect(itemRow({ ...newItem(1), pages: [{ id: 3700, text: 'a' }, { id: 3701, text: 'b' }] }).PageText).toBe('3700');
  });
  it('never lets an advanced value overwrite a modelled column', () => {
    expect(itemRow({ ...newItem(1), name: 'Real', advanced: { name: 'Fake', Quality: '5' } })).toMatchObject({ name: 'Real', Quality: '1' });
  });
  it('reads a row back into a typed item, keeping other columns in advanced', () => {
    const back = itemFromRow({ ...itemRow(sword), holy_res: 0, Material: '1' });
    expect(back).toEqual({ ...sword, pages: [], advanced: { fire_res: '10', RequiredSkill: '43', Material: '1' } });
  });
  it('reads stats from the tracker extra when the row has none, and ignores zero advanced values', () => {
    const item = itemFromRow({ entry: 5, name: 'Ring', Quality: 4, class: 4, subclass: 0, InventoryType: 11, spellid_1: 0 }, [{ type: 7, value: 9 }]);
    expect(item).toMatchObject({ entry: 5, name: 'Ring', quality: 'epic', itemClass: 4, inventoryType: 11, stats: [{ type: 7, value: 9 }], spells: [], damage: [], advanced: {} });
  });
  it('groups advanced columns and leaves modelled ones out', () => {
    const col = (name: string): ColumnInfo => ({ name, dataType: 'int', columnType: 'int', nullable: false, default: '0', ordinal: 0, isKey: false });
    const groups = advancedColumnGroups(['entry', 'name', 'holy_res', 'socketColor_1', 'itemset', 'RequiredSkill', 'Flags', 'MaxDurability', 'ScalingStatDistribution'].map(col));
    expect(groups.map((g) => [g.group, g.columns.map((c) => c.name)])).toEqual([
      ['Requirements', ['RequiredSkill']], ['Resistances', ['holy_res']], ['Sockets and gems', ['socketColor_1']],
      ['Set and randomness', ['itemset']], ['Flags', ['Flags']], ['Durability and misc', ['MaxDurability']], ['Other', ['ScalingStatDistribution']],
    ]);
    expect(MODELLED_ITEM_COLUMNS.has('stat_type10')).toBe(true);
    expect(advancedGroupOf('arcane_res')).toBe('Resistances');
  });
  it('names stats', () => {
    expect(statLabel(7)).toBe('Stamina');
    expect(statLabel(999)).toBe('Stat 999');
  });
});
