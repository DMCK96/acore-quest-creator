import { fightIssues } from '../combat/validate';
import type { Issue } from '../validate/validate';
import { npcFromRows } from './from-rows';
import { GOSSIP_SERVICES, serviceFlagBits } from '../game/gossip-services';
import { ENTITIES_FIELD, gossipUnread, sameGossip, sameGossipMenu, sameTrainer, trainerUnread, vendorUnread, type CustomItem, type CustomNpc, type CustomObject, type QuestEntities } from './model';
import { missingChoice } from '../patrol/compile';
import { npcSceneIssues } from '../scripts/npc-validate';

/**
 * Inventory types the server lets an NPC hold (`ObjectMgr::LoadEquipmentTemplates`): weapon, shield,
 * ranged, two-hand, main hand, off hand, held in off hand, thrown, wand/gun. Anything else it drops.
 */
const HELD_IN_HAND: ReadonlySet<number> = new Set([13, 14, 15, 17, 21, 22, 23, 25, 26]);

const NUMERIC_TYPES: ReadonlySet<string> = new Set(['tinyint', 'smallint', 'mediumint', 'int', 'bigint', 'float', 'double', 'decimal']);
const NUMBER = /^-?\d+(\.\d+)?$/;
/** `MAX_VENDOR_ITEMS`: the server reads no more rows than this for one vendor. */
const MAX_VENDOR_ITEMS = 150;
/** `ItemClass` Quest: something the player carries for a quest, never worn. */
const QUEST_CLASS = 12;

/** What the database says about the gossip menus a project's NPCs hold, for the checks that need more than the project */
export interface GossipFacts {
  /** For each menu id, the creatures (by entry) and the number of objects that use it as their menu */
  menuUsers: ReadonlyMap<number, { creatures: readonly number[]; objects: number }>;
  /** For each text id, the menus that use it */
  textMenus: ReadonlyMap<number, readonly number[]>;
  /** Whether the database has the menu (a row for it, or an option in it) */
  knownMenu: (id: number) => boolean;
}

/** The trainer id an existing NPC was read with, or '' when it had none */
const readTrainerId = (npc: CustomNpc): string => (npc.origin.kind === 'existing' ? (npc.origin.original.creature_default_trainer?.[0]?.TrainerId ?? '') : '');

/** What is wrong with the project's NPCs, objects and items, each issue routed to their module; an existing one is not checked for spawns or a taken entry. */
export function entityIssues(input: {
  entities: QuestEntities;
  dbNames: ReadonlyMap<string, string>;
  questItems?: readonly number[];
  /** Whether a spell is in the server's spell list; null when the list is not loaded. */
  knownSpell?: ((id: number) => boolean) | null;
  /** `RequiredNpcOrGo`, for fights that give quest credit. */
  objectives?: ReadonlyMap<number, readonly number[]>;
  /** `item_template.InventoryType` of the items NPCs hold, when read; null skips the weapon check. */
  itemInventoryTypes?: ReadonlyMap<number, number> | null;
  /** Whether a quest is in the world or the project; null skips the check of items that start one. */
  knownQuest?: ((id: number) => boolean) | null;
  /** `item_template` column name to its data type; null skips the check of advanced values. */
  itemColumnTypes?: ReadonlyMap<string, string> | null;
  /** Whether an item is in the world database or the project; null skips the check of what an NPC sells. */
  knownItem?: ((id: number) => boolean) | null;
  /** Whether an extended cost is in the server's `ItemExtendedCost.dbc`; null skips the check. */
  knownExtendedCost?: ((id: number) => boolean) | null;
  /** Which NPCs in the database use each trainer id now (by creature entry); null skips the checks that need it. */
  trainerUsers?: ReadonlyMap<number, readonly number[]> | null;
  /** What the database says about the gossip menus the project holds; null skips the checks that need it. */
  gossipFacts?: GossipFacts | null;
  /** Creature entries that a quest scene with a gossip option trigger belongs to. */
  sceneGossipOwners?: ReadonlySet<number>;
  /** NPC entries whose template in the database runs another AI or a script, so their scenes are not written. */
  scriptLocked?: ReadonlySet<number>;
  /** `RequiredNpcOrGo` of the quests NPC scenes are about, from the project and the database. */
  sceneObjectives?: ReadonlyMap<number, readonly number[]>;
}): Issue[] {
  const questItems = new Set(input.questItems ?? []);
  // How many of the project's NPCs hold each gossip menu and text id that is new to it (not one an existing NPC read)
  const newMenuIds = new Map<number, number>();
  const newTextIds = new Map<number, number>();
  const readMenus = (n: CustomNpc): Set<number> => {
    const original = n.origin.kind === 'existing' ? n.origin.original : undefined;
    return new Set((original?.gossip_menu ?? []).map((r) => Number(r.MenuID)));
  };
  for (const n of input.entities.npcs) {
    if (!n.gossipMenu || gossipUnread(n)) continue;
    const was = readMenus(n);
    for (const m of n.gossipMenu.menus) {
      if (m.locked || was.has(m.menuId)) continue;
      newMenuIds.set(m.menuId, (newMenuIds.get(m.menuId) ?? 0) + 1);
      newTextIds.set(m.textId, (newTextIds.get(m.textId) ?? 0) + 1);
    }
  }
  // How many of the project's NPCs hold each trainer id that is new to it (not one an existing NPC was read with)
  const newTrainerIds = new Map<number, number>();
  for (const n of input.entities.npcs) {
    if (!n.trainer || trainerUnread(n) || String(n.trainer.trainerId) === readTrainerId(n)) continue;
    newTrainerIds.set(n.trainer.trainerId, (newTrainerIds.get(n.trainer.trainerId) ?? 0) + 1);
  }
  const issues: Issue[] = [];
  /** Marks the issues added since `from` as being about this entity. */
  const tag = (from: number, kind: NonNullable<Issue['about']>['kind'], entry: number): void => {
    for (let i = from; i < issues.length; i++) issues[i] = { ...issues[i]!, about: { kind, entry } };
  };
  const check = (kind: 'creature' | 'gameobject', entity: CustomNpc | CustomObject): void => {
    const first = issues.length;
    const word = kind === 'creature' ? 'NPC' : 'Object';
    const label = entity.name.trim() ? `${word} "${entity.name.trim()}"` : `${word} ${entity.entry}`;
    const add = (severity: Issue['severity'], code: string, message: string): void => {
      issues.push({ severity, code, fieldId: ENTITIES_FIELD, message: `${label}: ${message}` });
    };
    if (entity.name.trim() === '') add('error', 'ENTITY_NO_NAME', 'give it a name.');
    if (entity.displayId <= 0) add('error', 'ENTITY_NO_MODEL', 'choose its model, or copy it from an existing one.');
    if ('minLevel' in entity && (entity.minLevel < 1 || entity.minLevel > entity.maxLevel)) {
      add('error', 'ENTITY_LEVELS', 'its minimum level must be at least 1 and no higher than its maximum.');
    }
    // Living players cannot see it, so cannot take or hand in its quests
    if ('seenBy' in entity && entity.seenBy === 'dead' && entity.questGiver) {
      add('warning', 'ENTITY_GHOST_GIVER', 'it gives quests but only dead players see it; set Seen by to living players, or living and dead.');
    }
    // An existing one already stands where the database has it, and its name is its own
    const existing = entity.origin.kind === 'existing';
    if (!existing && entity.spawns.length === 0) add('warning', 'ENTITY_NO_SPAWN', 'nothing places it in the world yet; add a spawn.');
    else if (!existing && entity.spawns.some((s) => s.x === 0 && s.y === 0 && s.z === 0)) {
      add('warning', 'ENTITY_SPAWN_ORIGIN', 'a spawn is still at 0, 0, 0; set where it stands.');
    }
    if ('equipment' in entity && input.itemInventoryTypes) {
      for (const [slot, word] of [['mainHand', 'main hand'], ['offHand', 'off hand'], ['ranged', 'ranged']] as const) {
        const item = entity.equipment[slot];
        if (item <= 0) continue;
        const type = input.itemInventoryTypes.get(item);
        if (type === undefined) add('warning', 'ENTITY_WEAPON', `the ${word} item ${item} is not in the world database.`);
        else if (!HELD_IN_HAND.has(type)) add('warning', 'ENTITY_WEAPON', `the ${word} item ${item} is not held in a hand, so it would not show.`);
      }
    }
    if ('fight' in entity) {
      for (const spawn of entity.spawns) {
        spawn.patrol?.points.forEach((point, i) => {
          for (const action of point.actions) {
            const missing = missingChoice(action);
            if (missing) add('warning', 'PATROL_UNPICKED', `at patrol point ${i + 1}, ${missing}.`);
          }
        });
      }
    }
    if ('pages' in entity) {
      if (entity.type === 'text' && entity.pages.length === 0) add('error', 'ENTITY_NO_PAGES', 'a readable object needs at least one page.');
      if (entity.pages.some((p) => p.text.trim() === '')) add('warning', 'ENTITY_EMPTY_PAGE', 'a page has no text.');
    }
    if ('pages' in entity && entity.type === 'chest' && entity.loot.length === 0) add('warning', 'LOOT_EMPTY_CHEST', 'the chest has nothing in it; add loot.');
    for (const row of entity.loot) {
      if (row.item <= 0) add('error', 'LOOT_NO_ITEM', 'a loot row has no item.');
      else if (questItems.has(row.item)) add('warning', 'LOOT_QUEST_ITEM', `item ${row.item} is one this quest asks for; set where it drops in Objectives.`);
      if (row.chance < 0 || row.chance > 100) add('error', 'LOOT_CHANCE', 'a drop chance must be between 0 and 100%.');
      if (row.min < 1 || row.min > row.max) add('error', 'LOOT_COUNT', 'the least dropped must be at least 1 and no more than the most.');
    }
    if ('vendor' in entity) {
      const seen = new Set<string>();
      const repeated = new Set<string>();
      const unknown = new Set<number>();
      const unknownCost = new Set<number>();
      for (const row of entity.vendor) {
        if (row.item === 0) {
          add('error', 'VENDOR_NO_ITEM', 'a stock row has no item.');
          continue;
        }
        const pair = `${row.item}/${row.extendedCost}`;
        if (seen.has(pair) && !repeated.has(pair)) {
          repeated.add(pair);
          add('error', 'VENDOR_DUPLICATE', `item ${row.item} is listed twice with the same extended cost; the database allows each pair once.`);
        }
        seen.add(pair);
        // The server skips limited stock that never restocks, and restocking stock that is not limited is ignored
        if (row.maxCount > 0 && row.restockSecs <= 0) {
          add('error', 'VENDOR_NO_RESTOCK', `item ${row.item} is limited to ${row.maxCount} but has no restock time, so the server would not load it; set how often it restocks.`);
        }
        // A negative item is another vendor's list, not an item to look up
        if (row.item > 0 && input.knownItem && !input.knownItem(row.item) && !unknown.has(row.item)) {
          unknown.add(row.item);
          add('warning', 'VENDOR_UNKNOWN_ITEM', `item ${row.item} is neither in the world database nor in this project.`);
        }
        if (row.extendedCost > 0 && input.knownExtendedCost && !input.knownExtendedCost(row.extendedCost) && !unknownCost.has(row.extendedCost)) {
          unknownCost.add(row.extendedCost);
          add('warning', 'VENDOR_UNKNOWN_COST', `extended cost ${row.extendedCost} is not in the server's ItemExtendedCost.dbc, so the server would skip its item.`);
        }
      }
      if (entity.vendor.length > MAX_VENDOR_ITEMS) {
        add('warning', 'VENDOR_TOO_MANY', `it sells ${entity.vendor.length} things; the server reads at most ${MAX_VENDOR_ITEMS} for one vendor and ignores the rest.`);
      }
      if (vendorUnread(entity) && entity.vendor.length > 0) {
        add('warning', 'VENDOR_NOT_READ', 'its stock was never read from the database, so this stock is not written; put the NPC back as the database has it and edit it again.');
      }
    }
    if ('trainer' in entity && entity.trainer) {
      const trainer = entity.trainer;
      if (trainerUnread(entity)) {
        add('warning', 'TRAINER_NOT_READ', 'its trainer was never read from the database, so this trainer is not written; put the NPC back as the database has it and edit it again.');
      } else {
        const existing = entity.origin.kind === 'existing' ? entity.origin : null;
        const asRead = existing ? npcFromRows(entity.entry, existing.original, { sharedLoot: existing.sharedLoot, spawnCount: existing.spawnCount, sharedTrainer: existing.sharedTrainer }).trainer : null;
        const readId = readTrainerId(entity);
        const underReadId = existing !== null && String(trainer.trainerId) === readId;
        const others = (id: number): number[] => (input.trainerUsers?.get(id) ?? []).filter((e) => e !== entity.entry);
        // Left as it was read, it is not written: the database's own quirks are not the author's to fix
        if (existing && sameTrainer(trainer, asRead)) {
          // nothing to check
        } else if (existing?.locked.includes('trainer')) {
          add('warning', 'TRAINER_LOCKED', 'its trainer is shared with other NPCs, so this edit is not written; use Give it its own copy in the editor first.');
        } else {
          if (underReadId && others(trainer.trainerId).length > 0) {
            add('error', 'TRAINER_SHARED', `trainer ${trainer.trainerId} is also used by ${others(trainer.trainerId).length} other NPC${others(trainer.trainerId).length === 1 ? '' : 's'}, so changing it would change theirs; use Give it its own copy in the editor first.`);
          }
          if (trainer.trainerId <= 0) add('error', 'TRAINER_NO_ID', 'it has no trainer id; allocate one with allocate_ids, kind trainer.');
          if (trainer.type === 'class' && trainer.requirement === 0) add('warning', 'TRAINER_NO_CLASS', 'it is a class trainer with no class chosen, so every class can train here; choose its class.');
          if (trainer.spells.length === 0) add('warning', 'TRAINER_EMPTY', 'it teaches nothing.');
          const seen = new Set<number>();
          const repeated = new Set<number>();
          for (const row of trainer.spells) {
            if (row.spell <= 0) {
              add('error', 'TRAINER_NO_SPELL', 'a spell row has no spell.');
              continue;
            }
            if (seen.has(row.spell) && !repeated.has(row.spell)) {
              repeated.add(row.spell);
              add('error', 'TRAINER_DUPLICATE', `spell ${row.spell} is listed twice; the database allows each spell once.`);
            }
            seen.add(row.spell);
            if (row.reqSpells.includes(row.spell)) add('error', 'TRAINER_REQ_SPELL', `spell ${row.spell} needs itself first.`);
          }
          if (input.knownSpell) {
            for (const spell of seen) if (!input.knownSpell(spell)) add('warning', 'TRAINER_UNKNOWN_SPELL', `spell ${spell} is not in the server's spell list.`);
          }
          // A trainer id new to the project must be its own: not another NPC's in the database, nor another new trainer's here
          if (!underReadId && trainer.trainerId > 0) {
            if (others(trainer.trainerId).length > 0) add('error', 'TRAINER_ID_TAKEN', `trainer id ${trainer.trainerId} is already used by another NPC in the database, so writing it would change that NPC's trainer; allocate a free one with allocate_ids, kind trainer.`);
            if ((newTrainerIds.get(trainer.trainerId) ?? 0) > 1) add('error', 'TRAINER_ID_DUPLICATE', `another NPC in this project has the same trainer id ${trainer.trainerId}; each trainer needs its own.`);
          }
        }
      }
    }
    // (Taking the whole menu away only clears the NPC's link: a menu with an option the database ties to a condition or a script is left in place)
    if ('gossipMenu' in entity && entity.gossipMenu) {
      const tree = entity.gossipMenu;
      if (gossipUnread(entity)) {
        add('warning', 'GOSSIP_NOT_READ', 'its gossip was never read from the database, so this menu is not written; put the NPC back as the database has it and edit it again.');
      } else {
        const existing = entity.origin.kind === 'existing' ? entity.origin : null;
        const asRead = existing ? npcFromRows(entity.entry, existing.original, { sharedLoot: existing.sharedLoot, spawnCount: existing.spawnCount, sharedMenus: existing.sharedMenus, sharedTexts: existing.sharedTexts }).gossipMenu : null;
        const treeChanged = !existing || !sameGossip(tree, asRead);
        const facts = input.gossipFacts ?? null;
        const otherUsers = (id: number): number => {
          const u = facts?.menuUsers.get(id);
          return u ? u.creatures.filter((e) => e !== entity.entry).length + u.objects : 0;
        };
        const ownMenuIds = new Set([...tree.menus.map((m) => m.menuId), ...(asRead?.menus.map((m) => m.menuId) ?? [])]);
        if (treeChanged) {
          // The option or menu the database ties to a condition or a script must still be there
          for (const before of asRead?.menus ?? []) {
            const kept = before.locked ? [] : before.options.filter((o) => o.kept);
            const now = tree.menus.find((m) => m.menuId === before.menuId);
            if (kept.some((o) => !now?.options.some((p) => p.optionId === o.optionId))) {
              add('error', 'GOSSIP_KEPT_REMOVED', `menu ${before.menuId} had an option the database ties to a condition or a script, and it is no longer there; keep it.`);
            }
          }
          if (!entity.gossip) add('warning', 'GOSSIP_NOT_TALKABLE', 'it has a gossip menu but cannot be talked to; turn on Can be talked to.');
          if (input.sceneGossipOwners?.has(entity.entry)) add('warning', 'GOSSIP_SCENE', 'a quest scene gives it a gossip option of its own, added to the first menu of this tree on the next free option id; export the quest again after changing which menu comes first.');
          // Which menus the root reaches
          const reached = new Set<number>([tree.menus[0]!.menuId]);
          for (let grew = true; grew; ) {
            grew = false;
            for (const m of tree.menus) {
              if (!reached.has(m.menuId)) continue;
              for (const o of m.options) if (o.action.kind === 'menu' && !reached.has(o.action.menuId)) { reached.add(o.action.menuId); grew = true; }
            }
          }
          // A menu taken out of the tree has its rows deleted (unless it is locked or holds a kept option), so nothing may still open it
          const removed = new Set((asRead?.menus ?? []).filter((b) => !b.locked && !b.options.some((o) => o.kept) && !tree.menus.some((m) => m.menuId === b.menuId)).map((b) => b.menuId));
          for (const m of tree.menus) for (const o of m.options) if (o.action.kind === 'menu' && removed.has(o.action.menuId)) add('error', 'GOSSIP_REMOVED_MENU', `option ${o.optionId} of menu ${m.menuId} opens menu ${o.action.menuId}, which this edit removes; point the option elsewhere or remove it.`);
          for (const m of tree.menus) if (!reached.has(m.menuId)) add('warning', 'GOSSIP_UNREACHABLE', `menu ${m.menuId} is not opened by any option, so players cannot reach it.`);
        }
        // What flags the NPC has, for the service options: the original row's, with the ones the project sets laid over
        const original = existing ? Number(existing.original.creature_template?.[0]?.npcflag ?? 0) : 0;
        const flags = (original & ~(1 | 2 | 16 | 128)) | (existing ? 0 : serviceFlagBits(tree)) | (entity.gossip ? 1 : 0) | (entity.questGiver ? 2 : 0) | (entity.trainer ? 16 : 0) | (entity.vendor.length > 0 ? 128 : 0);
        for (const m of tree.menus) {
          const before = asRead?.menus.find((x) => x.menuId === m.menuId);
          if (existing && before && sameGossipMenu(m, before)) continue;
          if (m.locked || before?.locked) {
            if (before) add('warning', 'GOSSIP_LOCKED', `menu ${m.menuId} is shared with other NPCs or objects, so this edit is not written; use Give it its own copy in the editor first.`);
            continue;
          }
          if (before && otherUsers(m.menuId) > 0) {
            add('error', 'GOSSIP_SHARED', `menu ${m.menuId} is also used by ${otherUsers(m.menuId)} other NPC${otherUsers(m.menuId) === 1 ? '' : 's'} or objects, so changing it would change theirs; use Give it its own copy in the editor first.`);
          }
          if (m.menuId <= 0 || m.textId <= 0) add('error', 'GOSSIP_NO_ID', `menu ${m.menuId} has no menu or text id; allocate them with allocate_ids, kinds gossipMenu and gossipText.`);
          if (m.greeting.every((v) => v.probability <= 0)) add('error', 'GOSSIP_NO_GREETING', `menu ${m.menuId} has no greeting that could be chosen: give a variant a chance above 0.`);
          else if (m.greeting.some((v) => v.text.trim() === '' && v.textFemale.trim() === '')) add('warning', 'GOSSIP_EMPTY_GREETING', `menu ${m.menuId} has a greeting variant with no text.`);
          const optionIds = new Set<number>();
          for (const o of m.options) {
            if (optionIds.has(o.optionId)) add('error', 'GOSSIP_OPTION_DUPLICATE', `menu ${m.menuId} has two options with id ${o.optionId}; each option needs its own.`);
            optionIds.add(o.optionId);
            if (o.text.trim() === '') add('error', 'GOSSIP_OPTION_NO_TEXT', `option ${o.optionId} of menu ${m.menuId} has no text.`);
            if (o.action.kind === 'menu' && !ownMenuIds.has(o.action.menuId) && facts && !facts.knownMenu(o.action.menuId)) {
              add('warning', 'GOSSIP_UNKNOWN_MENU', `option ${o.optionId} of menu ${m.menuId} opens menu ${o.action.menuId}, which neither the database nor this NPC has.`);
            }
            if (o.action.kind === 'service' && o.action.npcFlag === 0) add('warning', 'GOSSIP_SERVICE_FLAG', `option ${o.optionId} of menu ${m.menuId} has no NPC flag, so the server never shows it.`);
            if (o.action.kind === 'service' && o.action.npcFlag > 1 && (flags & o.action.npcFlag) !== o.action.npcFlag) {
              const service = o.action;
              const label = GOSSIP_SERVICES.find((s) => s.type === service.type && s.npcFlag === service.npcFlag)?.label ?? `type ${service.type}`;
              add('warning', 'GOSSIP_SERVICE_FLAG', `option ${o.optionId} of menu ${m.menuId} opens the ${label.toLowerCase()} window, but the NPC is not set up for it, so the option would never show.`);
            }
          }
          // An id new to the project must be its own: not another NPC's or object's, nor another new menu's here
          if (!before && m.menuId > 0) {
            if (otherUsers(m.menuId) > 0) add('error', 'GOSSIP_ID_TAKEN', `menu id ${m.menuId} is already used by another NPC or object, so writing it would change theirs; allocate a free one with allocate_ids, kind gossipMenu.`);
            if ((newMenuIds.get(m.menuId) ?? 0) > 1) add('error', 'GOSSIP_ID_DUPLICATE', `another menu in this project has the same menu id ${m.menuId}; each menu needs its own.`);
          }
          if (!before && m.textId > 0) {
            if ((facts?.textMenus.get(m.textId) ?? []).some((menu) => !ownMenuIds.has(menu))) add('error', 'GOSSIP_ID_TAKEN', `text id ${m.textId} is already used by another menu, so writing it would change theirs; allocate a free one with allocate_ids, kind gossipText.`);
            if ((newTextIds.get(m.textId) ?? 0) > 1) add('error', 'GOSSIP_ID_DUPLICATE', `another menu in this project has the same text id ${m.textId}; each menu needs its own.`);
          }
        }
      }
    }
    if ('fight' in entity && entity.fight) issues.push(...fightIssues(entity.fight, label, input.knownSpell ?? null, input.objectives ?? null));
    if ('scenes' in entity) {
      issues.push(...npcSceneIssues({ npc: entity, label, knownQuest: input.knownQuest ?? (() => true), locked: input.scriptLocked?.has(entity.entry) ?? false, objectives: input.sceneObjectives }));
    }
    const held = existing ? undefined : input.dbNames.get(`${kind}:${entity.entry}`);
    if (held !== undefined && held !== entity.name) {
      add('warning', 'ENTITY_TAKEN', `entry ${entity.entry} already holds "${held}" in the database, which this would replace.`);
    }
    tag(first, kind, entity.entry);
  };
  const checkItem = (item: CustomItem): void => {
    const first = issues.length;
    const label = item.name.trim() ? `Item "${item.name.trim()}"` : `Item ${item.entry}`;
    const add = (severity: Issue['severity'], code: string, message: string): void => {
      issues.push({ severity, code, fieldId: ENTITIES_FIELD, message: `${label}: ${message}` });
    };
    if (item.name.trim() === '') add('error', 'ITEM_NO_NAME', 'give it a name.');
    if (item.stackable < 1) add('error', 'ITEM_STACK', 'the stack size must be at least 1.');
    if (item.requiredLevel < 0 || item.itemLevel < 0) add('error', 'ITEM_LEVELS', 'the item and required levels cannot be negative.');
    if (item.stats.some((s) => s.type === 0)) add('error', 'ITEM_EMPTY_STAT', 'a stat row has no stat picked.');
    if (item.damage.some((d) => d.max === 0 || d.min > d.max)) add('error', 'ITEM_EMPTY_DAMAGE', 'a damage row has no damage.');
    if (item.spells.some((s) => s.spell === 0)) add('error', 'ITEM_EMPTY_SPELL', 'a spell row has no spell.');
    if (item.displayId <= 0) add('warning', 'ITEM_NO_LOOK', 'it has no look, so it shows as a question mark; choose a display ID.');
    if (item.inventoryType > 0 && item.itemClass === QUEST_CLASS) {
      add('warning', 'ITEM_QUEST_EQUIP', 'it can be equipped but its class is Quest; pick the class it should be.');
    }
    if (item.startsQuest > 0 && input.knownQuest && !input.knownQuest(item.startsQuest)) {
      add('warning', 'ITEM_STARTS_UNKNOWN', `it starts quest ${item.startsQuest}, which is neither in the world database nor in this project.`);
    }
    if (item.pages.some((p) => p.text.trim() === '')) add('warning', 'ITEM_EMPTY_PAGE', 'a page has no text.');
    if (input.itemColumnTypes) {
      for (const [column, value] of Object.entries(item.advanced)) {
        const type = input.itemColumnTypes.get(column);
        if (type !== undefined && NUMERIC_TYPES.has(type) && !NUMBER.test(value.trim())) {
          add('error', 'ITEM_ADVANCED_TYPE', `${column} must be a number, not "${value}".`);
        }
      }
    }
    const held = item.origin.kind === 'existing' ? undefined : input.dbNames.get(`item:${item.entry}`);
    if (held !== undefined && held !== item.name) {
      add('warning', 'ENTITY_TAKEN', `entry ${item.entry} already holds "${held}" in the database, which this would replace.`);
    }
    tag(first, 'item', item.entry);
  };
  for (const npc of input.entities.npcs) check('creature', npc);
  for (const object of input.entities.objects) check('gameobject', object);
  for (const item of input.entities.items ?? []) checkItem(item);
  return issues;
}
