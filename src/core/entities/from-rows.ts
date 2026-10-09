import { MODELLED_ITEM_COLUMNS, itemFromRow } from './item-columns';
import { seenByOf } from './visibility';
import { npcEventsOf } from './spawn-events';
import {
  NPC_TYPE_VALUE, OBJECT_TYPE_VALUE, RANK_VALUE, newItem, newNpc, newObject,
  type CustomItem, type CustomNpc, type CustomObject, type EntityLock, type LootRow, type OriginalRows, type Page, type Trainer, type VendorItem, type GossipMenu, type GossipOption, type GossipTree, type TextVariant,
  TRAINER_TYPE_VALUE,
} from './model';

/** How many other entries share an existing entity's loot and how many spawns it has */
export interface ExistingCounts {
  sharedLoot: number;
  spawnCount: number;
  /** How many other NPCs use its trainer */
  sharedTrainer?: number;
  /** For each menu id, how many other creatures and objects use it */
  sharedMenus?: Readonly<Record<number, number>>;
  /** For each text id, how many menus outside the NPC's own use it */
  sharedTexts?: Readonly<Record<number, number>>;
}

type Row = Record<string, string | null>;

const numberOf = (raw: string | null | undefined, fallback = 0): number => {
  const n = Number(raw);
  return raw === null || raw === undefined || raw === '' || !Number.isFinite(n) ? fallback : n;
};
const nameOf = <T extends Record<string, number>>(map: T, value: number, fallback: keyof T): keyof T =>
  (Object.keys(map) as (keyof T)[]).find((k) => map[k] === value) ?? fallback;

const origin = (rows: OriginalRows, counts: ExistingCounts, locked: EntityLock[]) =>
  ({ kind: 'existing', original: rows, sharedLoot: counts.sharedLoot, spawnCount: counts.spawnCount, sharedTrainer: counts.sharedTrainer ?? 0, sharedMenus: counts.sharedMenus ?? {}, sharedTexts: counts.sharedTexts ?? {}, locked }) as const;

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

/** How many menus an NPC's tree is read to: the rest of what its options open stay bare ids */
export const MAX_GOSSIP_MENUS = 24;

const VARIANTS = 8;

/** A menu's greeting: the variants up to the last that is used (a text, or a chance), at least one blank one */
function greetingOf(row: Row | undefined): TextVariant[] {
  const all = Array.from({ length: VARIANTS }, (_, i): TextVariant => ({ text: row?.[`text${i}_0`] ?? '', textFemale: row?.[`text${i}_1`] ?? '', probability: numberOf(row?.[`Probability${i}`]) }));
  const last = all.map((v) => v.text !== '' || v.textFemale !== '' || v.probability > 0).lastIndexOf(true);
  return last < 0 ? [{ text: '', textFemale: '', probability: 1 }] : all.slice(0, last + 1);
}

/**
 * The menus an NPC opens with and everything its options open, read from the rows. A menu is locked when it is
 * not ours to change: others use it or its text, it has several text rows or a conditioned one, or its text is missing.
 */
function gossipOf(rows: OriginalRows, counts: ExistingCounts): GossipTree | null {
  const rootId = numberOf(rows.creature_template?.[0]?.gossip_menu_id);
  // Gossip that was never read (no key) is not ours to model
  if (rootId <= 0 || !Object.prototype.hasOwnProperty.call(rows, 'gossip_menu')) return null;
  const menuRows = rows.gossip_menu ?? [];
  const optionRows = rows.gossip_menu_option ?? [];
  const textRows = rows.npc_text ?? [];
  const conditions = rows.conditions ?? [];
  const scripts = rows.smart_scripts ?? [];
  const optionsOf = (id: number): Row[] => optionRows.filter((r) => numberOf(r.MenuID) === id).sort((a, b) => numberOf(a.OptionID) - numberOf(b.OptionID));
  const known = (id: number): boolean => id === rootId || menuRows.some((r) => numberOf(r.MenuID) === id) || optionRows.some((r) => numberOf(r.MenuID) === id);
  const order: number[] = [];
  for (const queue = [rootId]; queue.length > 0 && order.length < MAX_GOSSIP_MENUS; ) {
    const id = queue.shift()!;
    if (order.includes(id) || !known(id)) continue;
    order.push(id);
    for (const o of optionsOf(id)) if (numberOf(o.ActionMenuID) > 0) queue.push(numberOf(o.ActionMenuID));
  }
  // A text two menus of the tree name is theirs together: neither can change it alone
  const textUses = new Map<number, number>();
  for (const id of order) {
    const t = numberOf(menuRows.find((r) => numberOf(r.MenuID) === id)?.TextID);
    textUses.set(t, (textUses.get(t) ?? 0) + 1);
  }
  const menus = order.map((id): GossipMenu => {
    const own = menuRows.filter((r) => numberOf(r.MenuID) === id);
    const textId = numberOf(own[0]?.TextID);
    const text = textRows.find((r) => numberOf(r.ID) === textId);
    const conditioned = conditions.some((c) => numberOf(c.SourceTypeOrReferenceId) === 14 && numberOf(c.SourceGroup) === id);
    const locked = (counts.sharedMenus?.[id] ?? 0) > 0 || (counts.sharedTexts?.[textId] ?? 0) > 0 || (textUses.get(textId) ?? 0) > 1 || own.length !== 1 || conditioned || !text || textId <= 0;
    const options = optionsOf(id).map((r): GossipOption => {
      const optionId = numberOf(r.OptionID);
      const tied = conditions.some((c) => numberOf(c.SourceTypeOrReferenceId) === 15 && numberOf(c.SourceGroup) === id && numberOf(c.SourceEntry) === optionId) ||
        scripts.some((s) => numberOf(s.source_type) === 0 && numberOf(s.event_type) === 62 && numberOf(s.event_param1) === id && numberOf(s.event_param2) === optionId);
      const type = numberOf(r.OptionType);
      const npcFlag = numberOf(r.OptionNpcFlag);
      const next = numberOf(r.ActionMenuID);
      return {
        optionId, icon: numberOf(r.OptionIcon), text: r.OptionText ?? '', kept: tied,
        action: next > 0 ? { kind: 'menu', menuId: next } : type === 1 && npcFlag === 1 ? { kind: 'close' } : { kind: 'service', type, npcFlag },
      };
    });
    return { menuId: id, textId, greeting: greetingOf(text), options, locked };
  });
  // A menu only a locked menu opens is used by everyone who uses that one
  for (let changed = true; changed; ) {
    changed = false;
    for (const m of menus) {
      if (!m.locked) continue;
      for (const o of m.options) {
        const next = o.action.kind === 'menu' ? menus.find((x) => x.menuId === (o.action as { menuId: number }).menuId) : undefined;
        if (next && !next.locked) {
          next.locked = true;
          changed = true;
        }
      }
    }
  }
  return { menus };
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
    loot, fight: null, spawns: [], vendor: vendorOf(rows.npc_vendor), trainer, gossipMenu: gossipOf(rows, counts),
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
