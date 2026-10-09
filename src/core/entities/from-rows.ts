import { MODELLED_ITEM_COLUMNS, itemFromRow } from './item-columns';
import { seenByOf } from './visibility';
import { npcEventsOf } from './spawn-events';
import {
  NPC_TYPE_VALUE, OBJECT_TYPE_VALUE, RANK_VALUE, newItem, newNpc, newObject,
  type CustomItem, type CustomNpc, type CustomObject, type EntityLock, type LootRow, type OriginalRows, type Page, type Trainer, type VendorItem,
  TRAINER_TYPE_VALUE,
} from './model';

/** How many other entries share an existing entity's loot and how many spawns it has */
export interface ExistingCounts {
  sharedLoot: number;
  spawnCount: number;
  /** How many other NPCs use its trainer */
  sharedTrainer?: number;
}

type Row = Record<string, string | null>;

const numberOf = (raw: string | null | undefined, fallback = 0): number => {
  const n = Number(raw);
  return raw === null || raw === undefined || raw === '' || !Number.isFinite(n) ? fallback : n;
};
const nameOf = <T extends Record<string, number>>(map: T, value: number, fallback: keyof T): keyof T =>
  (Object.keys(map) as (keyof T)[]).find((k) => map[k] === value) ?? fallback;

const origin = (rows: OriginalRows, counts: ExistingCounts, locked: EntityLock[]) =>
  ({ kind: 'existing', original: rows, sharedLoot: counts.sharedLoot, spawnCount: counts.spawnCount, sharedTrainer: counts.sharedTrainer ?? 0, locked }) as const;

/** The loot a plain list holds; lists with references or groups cannot be edited as one list, so none */
function lootOf(rows: Row[] | undefined): { loot: LootRow[]; locked: boolean } {
  const list = rows ?? [];
  if (list.some((r) => (r.Reference ?? '0') !== '0' || (r.GroupId ?? '0') !== '0')) return { loot: [], locked: true };
  return {
    loot: list.map((r) => ({ item: numberOf(r.Item), chance: numberOf(r.Chance), min: numberOf(r.MinCount, 1), max: numberOf(r.MaxCount, 1), questOnly: r.QuestRequired === '1' })),
    locked: false,
  };
}

/** What an NPC sells, in slot order */
function vendorOf(rows: Row[] | undefined): VendorItem[] {
  return [...(rows ?? [])]
    .sort((a, b) => numberOf(a.slot) - numberOf(b.slot))
    .map((r) => ({ item: numberOf(r.item), maxCount: numberOf(r.maxcount), restockSecs: numberOf(r.incrtime), extendedCost: numberOf(r.ExtendedCost) }));
}

/**
 * The trainer an NPC uses, read from its default-trainer row, the trainer row and the spells under it. A type
 * the editor has no name for, or a trainer row that is missing, cannot be modelled: it is left alone (locked).
 */
function trainerOf(rows: OriginalRows): { trainer: Trainer | null; locked: boolean } {
  const link = rows.creature_default_trainer?.[0];
  if (!link) return { trainer: null, locked: false };
  const id = numberOf(link.TrainerId);
  const row = (rows.trainer ?? []).find((r) => numberOf(r.Id) === id);
  const type = (Object.keys(TRAINER_TYPE_VALUE) as (keyof typeof TRAINER_TYPE_VALUE)[]).find((k) => TRAINER_TYPE_VALUE[k] === numberOf(row?.Type, -1));
  if (!row || !type) return { trainer: null, locked: true };
  const spells = (rows.trainer_spell ?? [])
    .filter((r) => numberOf(r.TrainerId) === id)
    .sort((a, b) => numberOf(a.SpellId) - numberOf(b.SpellId))
    .map((r) => ({
      spell: numberOf(r.SpellId), cost: numberOf(r.MoneyCost), reqLevel: numberOf(r.ReqLevel), reqSkill: numberOf(r.ReqSkillLine), reqSkillRank: numberOf(r.ReqSkillRank),
      reqSpells: [r.ReqAbility1, r.ReqAbility2, r.ReqAbility3].map((v) => numberOf(v)).filter((v) => v > 0),
    }));
  return { trainer: { trainerId: id, type, requirement: numberOf(row.Requirement), greeting: row.Greeting ?? '', spells }, locked: false };
}

/** The page chain starting at `first`, following `NextPageID` */
function pagesFrom(first: number, rows: Row[] | undefined): Page[] {
  const byId = new Map((rows ?? []).map((r) => [numberOf(r.ID), r]));
  const pages: Page[] = [];
  const seen = new Set<number>();
  for (let id = first; id > 0 && !seen.has(id); ) {
    const row = byId.get(id);
    if (!row) break;
    seen.add(id);
    pages.push({ id, text: row.Text ?? '' });
    id = numberOf(row.NextPageID);
  }
  return pages;
}

export function npcFromRows(entry: number, rows: OriginalRows, counts: ExistingCounts): CustomNpc {
  const row = rows.creature_template?.[0] ?? {};
  const models = [...(rows.creature_template_model ?? [])].sort((a, b) => numberOf(a.Idx) - numberOf(b.Idx));
  const model = models[0];
  const gear = (rows.creature_equip_template ?? []).find((r) => numberOf(r.ID) === 1) ?? rows.creature_equip_template?.[0];
  const flags = numberOf(row.npcflag);
  const { loot, locked: lootLocked } = lootOf(rows.creature_loot_template);
  const locked: EntityLock[] = [];
  if (lootLocked) locked.push('loot');
  if ((row.AIName ?? '') !== '' || (row.ScriptName ?? '') !== '') locked.push('fight');
  // A trainer other NPCs share is not ours to change, and one the editor cannot model is left as it is
  const { trainer, locked: trainerLocked } = trainerOf(rows);
  if (trainerLocked || (trainer !== null && (counts.sharedTrainer ?? 0) > 0)) locked.push('trainer');
  return {
    ...newNpc(entry),
    name: row.name ?? '', subname: row.subname ?? '',
    minLevel: numberOf(row.minlevel, 1), maxLevel: numberOf(row.maxlevel, 1), faction: numberOf(row.faction, 35),
    rank: nameOf(RANK_VALUE, numberOf(row.rank), 'normal'), type: nameOf(NPC_TYPE_VALUE, numberOf(row.type), 'none'),
    questGiver: (flags & 2) !== 0, gossip: (flags & 1) !== 0, seenBy: seenByOf(row),
    // Read from its spawns' rows when they were read; a project saved before then leaves them as they are
    events: rows.creature ? npcEventsOf(rows.creature.map((r) => numberOf(r.guid)), rows.game_event_creature ?? []) : 'asIs',
    healthModifier: numberOf(row.HealthModifier, 1), damageModifier: numberOf(row.DamageModifier, 1),
    displayId: model ? numberOf(model.CreatureDisplayID) : numberOf(row.modelid1), scale: numberOf(model?.DisplayScale, 1),
    equipment: { mainHand: numberOf(gear?.ItemID1), offHand: numberOf(gear?.ItemID2), ranged: numberOf(gear?.ItemID3) },
    loot, fight: null, spawns: [], vendor: vendorOf(rows.npc_vendor), trainer,
    origin: origin(rows, counts, locked),
  };
}

export function objectFromRows(entry: number, rows: OriginalRows, counts: ExistingCounts): CustomObject {
  const row = rows.gameobject_template?.[0] ?? {};
  const raw = numberOf(row.type);
  const known = (Object.values(OBJECT_TYPE_VALUE) as number[]).includes(raw);
  const type = known ? nameOf(OBJECT_TYPE_VALUE, raw, 'generic') : 'generic';
  const { loot, locked: lootLocked } = lootOf(rows.gameobject_loot_template);
  const locked: EntityLock[] = [];
  if (!known) locked.push('type');
  if (lootLocked) locked.push('loot');
  const quest = numberOf(type === 'goober' ? row.Data1 : type === 'chest' ? row.Data8 : undefined);
  const pageStart = type === 'text' ? numberOf(row.Data0) : type === 'goober' ? numberOf(row.Data7) : 0;
  return {
    ...newObject(entry),
    name: row.name ?? '', type, displayId: numberOf(row.displayId), size: numberOf(row.size, 1),
    pages: pagesFrom(pageStart, rows.page_text), onlyDuringQuest: quest > 0 ? quest : null,
    loot, spawns: [], origin: origin(rows, counts, locked),
  };
}

export function itemFromRows(entry: number, rows: OriginalRows): CustomItem {
  const row = rows.item_template?.[0] ?? {};
  const item = itemFromRow(row);
  // An existing item keeps every column it has, zeros included, so editing it never drops a value
  const advanced: Record<string, string> = {};
  for (const [column, value] of Object.entries(row)) if (!MODELLED_ITEM_COLUMNS.has(column) && value !== null) advanced[column] = value;
  return {
    ...newItem(entry), ...item, entry, advanced,
    pages: pagesFrom(numberOf(row.PageText), rows.page_text),
    origin: origin(rows, { sharedLoot: 0, spawnCount: 0 }, []),
  };
}
