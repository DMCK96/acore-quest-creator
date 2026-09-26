import type { ColumnInfo } from '../db/types';
import { BONDING_VALUE, ITEM_QUALITY_VALUE, newItem, type CustomItem, type ItemDamage, type ItemSpell, type ItemStat } from './model';

/**
 * A custom item as an `item_template` row and back. The typed fields own the columns listed in
 * `MODELLED_ITEM_COLUMNS`; every other column lives in the item's `advanced` bag as raw text, so an
 * imported item keeps what it came with and the editor can still show it behind "advanced".
 */

const STAT_SLOTS = 10;
const DAMAGE_SLOTS = 2;
const SPELL_SLOTS = 5;
const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

export const MODELLED_ITEM_COLUMNS: ReadonlySet<string> = new Set([
  'entry', 'name', 'description', 'Quality', 'class', 'subclass', 'InventoryType', 'displayid', 'ItemLevel', 'RequiredLevel',
  'stackable', 'maxcount', 'bonding', 'BuyPrice', 'SellPrice', 'startquest', 'PageText', 'armor', 'delay', 'StatsCount',
  ...range(STAT_SLOTS).flatMap((n) => [`stat_type${n}`, `stat_value${n}`]),
  ...range(DAMAGE_SLOTS).flatMap((n) => [`dmg_min${n}`, `dmg_max${n}`, `dmg_type${n}`]),
  ...range(SPELL_SLOTS).flatMap((n) => [`spellid_${n}`, `spelltrigger_${n}`, `spellcharges_${n}`, `spellcooldown_${n}`, `spellcategory_${n}`, `spellcategorycooldown_${n}`]),
]);

const lower = (names: readonly string[]): ReadonlySet<string> => new Set(names.map((n) => n.toLowerCase()));
const REQUIREMENTS = lower([
  'AllowableClass', 'AllowableRace', 'requiredspell', 'requiredhonorrank', 'RequiredCityRank', 'RequiredReputationFaction',
  'RequiredReputationRank', 'RequiredDisenchantSkill', 'area', 'Map', 'HolidayId',
]);
const SET_AND_RANDOM = lower(['itemset', 'RandomProperty', 'RandomSuffix']);
const FLAGS = lower(['Flags', 'FlagsExtra', 'flagsCustom']);
const DURABILITY_AND_MISC = lower([
  'MaxDurability', 'Material', 'sheath', 'BagFamily', 'TotemCategory', 'ContainerSlots', 'LockID', 'block', 'ammo_type', 'RangedModRange',
  'duration', 'DisenchantID', 'FoodType', 'minMoneyLoot', 'maxMoneyLoot', 'SoundOverrideSubclass', 'LanguageID', 'PageMaterial', 'ItemLimitCategory',
]);

/** The groups the advanced tab shows, in order; "Other" catches the rest. */
export const ADVANCED_GROUP_ORDER = ['Requirements', 'Resistances', 'Sockets and gems', 'Set and randomness', 'Flags', 'Durability and misc', 'Other'] as const;

export function advancedGroupOf(column: string): string {
  const c = column.toLowerCase();
  if ((c.startsWith('required') && c !== 'requiredlevel') || REQUIREMENTS.has(c)) return 'Requirements';
  if (c.endsWith('_res')) return 'Resistances';
  if (c.startsWith('socket') || c === 'gemproperties') return 'Sockets and gems';
  if (SET_AND_RANDOM.has(c)) return 'Set and randomness';
  if (FLAGS.has(c)) return 'Flags';
  if (DURABILITY_AND_MISC.has(c)) return 'Durability and misc';
  return 'Other';
}

/** The columns the advanced tab lists, grouped; the modelled ones are edited elsewhere. */
export function advancedColumnGroups(columns: readonly ColumnInfo[]): { group: string; columns: ColumnInfo[] }[] {
  const byGroup = new Map<string, ColumnInfo[]>();
  for (const column of columns) {
    if (MODELLED_ITEM_COLUMNS.has(column.name)) continue;
    const group = advancedGroupOf(column.name);
    byGroup.set(group, [...(byGroup.get(group) ?? []), column]);
  }
  return ADVANCED_GROUP_ORDER.flatMap((group) => {
    const found = byGroup.get(group);
    return found ? [{ group, columns: found }] : [];
  });
}

const text = (n: number): string => String(n);

export function itemRow(item: CustomItem): Record<string, string> {
  const row: Record<string, string> = {};
  // Advanced first, so a typed field always wins over a stray advanced copy of its column.
  for (const [column, value] of Object.entries(item.advanced)) if (!MODELLED_ITEM_COLUMNS.has(column)) row[column] = value;
  Object.assign(row, {
    entry: text(item.entry), name: item.name, description: item.description, Quality: text(ITEM_QUALITY_VALUE[item.quality]),
    class: text(item.itemClass), subclass: text(item.subclass), InventoryType: text(item.inventoryType), displayid: text(item.displayId),
    ItemLevel: text(item.itemLevel), RequiredLevel: text(item.requiredLevel), stackable: text(item.stackable), maxcount: text(item.maxCount),
    bonding: text(BONDING_VALUE[item.bonding]), BuyPrice: text(item.buyPrice), SellPrice: text(item.sellPrice), startquest: text(item.startsQuest),
    PageText: text(item.pages[0]?.id ?? 0), armor: text(item.armor), delay: text(item.delayMs), StatsCount: text(item.stats.length),
  });
  for (const n of range(STAT_SLOTS)) {
    const stat = item.stats[n - 1];
    row[`stat_type${n}`] = text(stat?.type ?? 0);
    row[`stat_value${n}`] = text(stat?.value ?? 0);
  }
  for (const n of range(DAMAGE_SLOTS)) {
    const dmg = item.damage[n - 1];
    row[`dmg_min${n}`] = text(dmg?.min ?? 0);
    row[`dmg_max${n}`] = text(dmg?.max ?? 0);
    row[`dmg_type${n}`] = text(dmg?.school ?? 0);
  }
  for (const n of range(SPELL_SLOTS)) {
    const spell = item.spells[n - 1];
    row[`spellid_${n}`] = text(spell?.spell ?? 0);
    row[`spelltrigger_${n}`] = text(spell?.trigger ?? 0);
    row[`spellcharges_${n}`] = text(spell?.charges ?? 0);
    // -1 is AzerothCore's "use the spell's own cooldown".
    row[`spellcooldown_${n}`] = text(spell?.cooldownMs ?? -1);
    row[`spellcategory_${n}`] = text(spell?.category ?? 0);
    row[`spellcategorycooldown_${n}`] = text(spell?.categoryCooldownMs ?? -1);
  }
  return row;
}

type RowValue = string | number | null | undefined;

const keyOf = <T extends Record<string, number>>(table: T, value: number, fallback: keyof T & string): keyof T & string =>
  (Object.keys(table) as (keyof T & string)[]).find((k) => table[k] === value) ?? fallback;

/** An `item_template` row as a typed item; columns it lacks keep `newItem`'s values. */
export function itemFromRow(row: Readonly<Record<string, RowValue>>, extraStats: readonly ItemStat[] = []): CustomItem {
  const base = newItem(0);
  const has = (column: string): boolean => row[column] !== undefined && row[column] !== null && row[column] !== '';
  const n = (column: string, fallback: number): number => {
    if (!has(column)) return fallback;
    const v = Number(row[column]);
    return Number.isFinite(v) ? v : fallback;
  };
  const stats: ItemStat[] = [];
  for (const i of range(STAT_SLOTS)) {
    const type = n(`stat_type${i}`, 0);
    const value = n(`stat_value${i}`, 0);
    if (type !== 0 && value !== 0) stats.push({ type, value });
  }
  const damage: ItemDamage[] = [];
  for (const i of range(DAMAGE_SLOTS)) {
    const min = n(`dmg_min${i}`, 0);
    const max = n(`dmg_max${i}`, 0);
    if (min !== 0 || max !== 0) damage.push({ min, max, school: n(`dmg_type${i}`, 0) });
  }
  const spells: ItemSpell[] = [];
  for (const i of range(SPELL_SLOTS)) {
    const spell = n(`spellid_${i}`, 0);
    if (spell === 0) continue;
    spells.push({
      spell, trigger: n(`spelltrigger_${i}`, 0), charges: n(`spellcharges_${i}`, 0), cooldownMs: n(`spellcooldown_${i}`, -1),
      category: n(`spellcategory_${i}`, 0), categoryCooldownMs: n(`spellcategorycooldown_${i}`, -1),
    });
  }
  const advanced: Record<string, string> = {};
  for (const [column, value] of Object.entries(row)) {
    if (MODELLED_ITEM_COLUMNS.has(column) || value === null || value === undefined || value === '' || value === 0 || value === '0') continue;
    advanced[column] = String(value);
  }
  return {
    ...base,
    entry: n('entry', 0),
    name: has('name') ? String(row.name) : '',
    description: has('description') ? String(row.description) : '',
    quality: keyOf(ITEM_QUALITY_VALUE, n('Quality', ITEM_QUALITY_VALUE[base.quality]), base.quality),
    itemClass: n('class', base.itemClass),
    subclass: n('subclass', base.subclass),
    inventoryType: n('InventoryType', base.inventoryType),
    displayId: n('displayid', base.displayId),
    itemLevel: n('ItemLevel', base.itemLevel),
    requiredLevel: n('RequiredLevel', base.requiredLevel),
    stackable: n('stackable', base.stackable),
    maxCount: n('maxcount', base.maxCount),
    bonding: keyOf(BONDING_VALUE, n('bonding', BONDING_VALUE[base.bonding]), base.bonding),
    buyPrice: n('BuyPrice', base.buyPrice),
    sellPrice: n('SellPrice', base.sellPrice),
    startsQuest: n('startquest', base.startsQuest),
    armor: n('armor', base.armor),
    delayMs: n('delay', base.delayMs),
    damage,
    stats: stats.length > 0 ? stats : extraStats.filter((s) => s.type !== 0),
    spells,
    advanced,
  };
}
