/**
 * The 3.3.5 item vocabulary the item editor names values with: `ItemClass`, the subclasses the
 * editor offers by name, `InventoryType`, `ItemModType` and the spell triggers, as the server's
 * `ItemTemplate.h` numbers them. A value not listed is still valid; it is just shown as a number.
 */

type Named = readonly (readonly [number, string])[];

export const ITEM_CLASSES: Named = [
  [0, 'Consumable'], [1, 'Container'], [2, 'Weapon'], [3, 'Gem'], [4, 'Armor'], [5, 'Reagent'], [6, 'Projectile'],
  [7, 'Trade Goods'], [8, 'Generic'], [9, 'Recipe'], [10, 'Money'], [11, 'Quiver'], [12, 'Quest'], [13, 'Key'],
  [14, 'Permanent'], [15, 'Miscellaneous'], [16, 'Glyph'],
];

export const ITEM_SUBCLASSES: Readonly<Record<number, Named>> = {
  0: [[0, 'Consumable'], [1, 'Potion'], [2, 'Elixir'], [3, 'Flask'], [4, 'Scroll'], [5, 'Food & Drink'], [6, 'Item Enhancement'], [7, 'Bandage'], [8, 'Other']],
  2: [
    [0, 'Axe (one-hand)'], [1, 'Axe (two-hand)'], [2, 'Bow'], [3, 'Gun'], [4, 'Mace (one-hand)'], [5, 'Mace (two-hand)'], [6, 'Polearm'],
    [7, 'Sword (one-hand)'], [8, 'Sword (two-hand)'], [9, 'Obsolete'], [10, 'Staff'], [11, 'Exotic'], [12, 'Exotic (two-hand)'], [13, 'Fist Weapon'],
    [14, 'Miscellaneous'], [15, 'Dagger'], [16, 'Thrown'], [17, 'Spear'], [18, 'Crossbow'], [19, 'Wand'], [20, 'Fishing Pole'],
  ],
  4: [[0, 'Miscellaneous'], [1, 'Cloth'], [2, 'Leather'], [3, 'Mail'], [4, 'Plate'], [6, 'Shield'], [7, 'Libram'], [8, 'Idol'], [9, 'Totem'], [10, 'Sigil']],
  7: [
    [0, 'Trade Goods'], [1, 'Parts'], [2, 'Explosives'], [3, 'Devices'], [4, 'Jewelcrafting'], [5, 'Cloth'], [6, 'Leather'], [7, 'Metal & Stone'],
    [8, 'Meat'], [9, 'Herb'], [10, 'Elemental'], [11, 'Other'], [12, 'Enchanting'], [13, 'Materials'], [14, 'Armor Enchantment'], [15, 'Weapon Enchantment'],
  ],
  12: [[0, 'Quest']],
  15: [[0, 'Junk'], [1, 'Reagent'], [2, 'Pet'], [3, 'Holiday'], [4, 'Other'], [5, 'Mount']],
};

export const INVENTORY_TYPES: Named = [
  [0, 'Not equippable'], [1, 'Head'], [2, 'Neck'], [3, 'Shoulder'], [4, 'Shirt'], [5, 'Chest'], [6, 'Waist'], [7, 'Legs'], [8, 'Feet'],
  [9, 'Wrists'], [10, 'Hands'], [11, 'Finger'], [12, 'Trinket'], [13, 'One-hand'], [14, 'Shield'], [15, 'Ranged (bow)'], [16, 'Back'],
  [17, 'Two-hand'], [18, 'Bag'], [19, 'Tabard'], [20, 'Robe'], [21, 'Main hand'], [22, 'Off hand'], [23, 'Held in off hand'], [24, 'Ammo'],
  [25, 'Thrown'], [26, 'Ranged (gun, crossbow, wand)'], [27, 'Quiver'], [28, 'Relic'],
];

export const STAT_TYPES: Named = [
  [0, 'Mana'], [1, 'Health'], [3, 'Agility'], [4, 'Strength'], [5, 'Intellect'], [6, 'Spirit'], [7, 'Stamina'],
  [12, 'Defense Rating'], [13, 'Dodge Rating'], [14, 'Parry Rating'], [15, 'Block Rating'], [16, 'Melee Hit Rating'], [17, 'Ranged Hit Rating'],
  [18, 'Spell Hit Rating'], [19, 'Melee Crit Rating'], [20, 'Ranged Crit Rating'], [21, 'Spell Crit Rating'], [28, 'Melee Haste Rating'],
  [29, 'Ranged Haste Rating'], [30, 'Spell Haste Rating'], [31, 'Hit Rating'], [32, 'Crit Rating'], [35, 'Resilience Rating'], [36, 'Haste Rating'],
  [37, 'Expertise Rating'], [38, 'Attack Power'], [39, 'Ranged Attack Power'], [40, 'Feral Attack Power'], [41, 'Healing Done'],
  [42, 'Spell Damage Done'], [43, 'Mana Regeneration'], [44, 'Armor Penetration Rating'], [45, 'Spell Power'], [46, 'Health Regeneration'],
  [47, 'Spell Penetration'], [48, 'Block Value'],
];

export const SPELL_TRIGGERS: Named = [[0, 'Use'], [1, 'On equip'], [2, 'Chance on hit'], [4, 'Soulstone'], [5, 'Use with no delay'], [6, 'Learn']];

export const DAMAGE_SCHOOLS: Named = [[0, 'Physical'], [1, 'Holy'], [2, 'Fire'], [3, 'Nature'], [4, 'Frost'], [5, 'Shadow'], [6, 'Arcane']];

const nameIn = (list: Named, value: number): string | undefined => list.find(([v]) => v === value)?.[1];

export function statLabel(type: number): string {
  return nameIn(STAT_TYPES, type) ?? `Stat ${type}`;
}

export function classLabel(itemClass: number): string {
  return nameIn(ITEM_CLASSES, itemClass) ?? `Class ${itemClass}`;
}
