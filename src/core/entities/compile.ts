import { fightIsEmpty } from '../combat/model';
import { hasPointActions } from '../patrol/compile';
import type { CompiledScripts } from '../scripts/compile';
import { entityLootTag, entityOf, entityTag } from '../scripts/tag';
import type { EntityContext } from './context';
import { itemRow, MODELLED_ITEM_COLUMNS } from './item-columns';
import { MOVEMENT_TYPE } from '../world/movement';
import { NPC_TYPE_VALUE, OBJECT_TYPE_VALUE, RANK_VALUE, type LootRow, type Patrol, type Page, type ProjectEntities } from './model';

/**
 * New NPCs and objects to template and spawn rows, in the same shape as compiled scripts so one
 * renderer turns both into patch statements. Every key is pinned in the project, so each export
 * deletes and re-inserts the same rows; the columns quest scripting manages on a template are
 * carried over from the database so a re-insert never undoes them.
 */

type Row = Record<string, string>;

const GOSSIP_BIT = 1;
const QUEST_GIVER_BIT = 2;
/** `UNIT_CLASS_WARRIOR`: the plain melee class every simple NPC uses. */
const UNIT_CLASS = 1;
/** `GO_STATE_READY` and the fully drawn animation every placed object starts with. */
const GO_READY = 1;
const ANIM_FULL = 100;
const PACE_MOVE_TYPE = { walk: 0, run: 1 } as const;

/** A patrol with a route to walk; one point alone is no route. */
const walking = (patrol: Patrol | null): patrol is Patrol => patrol !== null && patrol.points.length >= 2;

/**
 * One `waypoint_data` row per point, then one back where the spawn stands: the server loops a path's
 * own points only, so without it the NPC would go from the last point straight to the first. Each
 * row's pace is the one it walks there at.
 */
function routeRows(patrol: Patrol, home: { x: number; y: number; z: number }): Record<string, string>[] {
  let pace = patrol.startPace;
  const rows = patrol.points.map((point, i) => {
    const row: Record<string, string> = {
      id: String(patrol.pathId), point: String(i + 1), position_x: String(point.x), position_y: String(point.y), position_z: String(point.z),
      delay: String(Math.round(point.waitSecs * 1000)), move_type: String(PACE_MOVE_TYPE[pace]), action: '0', action_chance: '100', wpguid: '0',
      velocity: '0', smoothTransition: '0',
    };
    // Left out, the column stays NULL and the server does not turn the NPC.
    if (point.facing !== null) row.orientation = String(point.facing);
    if (point.paceFromHere !== null) pace = point.paceFromHere;
    return row;
  });
  rows.push({
    id: String(patrol.pathId), point: String(patrol.points.length + 1), position_x: String(home.x), position_y: String(home.y), position_z: String(home.z),
    delay: '0', move_type: String(PACE_MOVE_TYPE[pace]), action: '0', action_chance: '100', wpguid: '0', velocity: '0', smoothTransition: '0',
  });
  return rows;
}

const text = (n: number): string => String(n);
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;
const num = (raw: string | null | undefined): number => {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** A spawn tag exports before version 4 wrote: the quest's, then the entity's */
const LEGACY_SPAWN_TAG = /^AQC q\d+ (npc|obj)(\d+)$/;
const LEGACY_LOOT_TAG = /^AQC q\d+ loot$/;

export function compileEntities(input: {
  entities: ProjectEntities;
  /** Creature entries any project quest starts or ends with. */
  givers: readonly number[];
  /** Items project quests require, with the quest: their drops belong to Objectives, so loot lists never write them. */
  questItems?: readonly { item: number; questId: number }[];
  context: EntityContext;
  /** The `item_template` columns the export database has; null or absent when not known. */
  itemColumns?: ReadonlySet<string> | null;
}): CompiledScripts {
  const { entities, givers, context } = input;
  const questItems = new Map<number, number>();
  for (const { item, questId } of input.questItems ?? []) if (!questItems.has(item)) questItems.set(item, questId);
  const lootKeys: Record<'creature_loot_template' | 'gameobject_loot_template', Map<string, Row>> = {
    creature_loot_template: new Map(),
    gameobject_loot_template: new Map(),
  };
  const writeLoot = (table: 'creature_loot_template' | 'gameobject_loot_template', entry: number, loot: readonly LootRow[], label: string): number => {
    let written = 0;
    const lootTag = entityLootTag(table === 'creature_loot_template' ? 'npc' : 'obj', entry);
    for (const row of loot) {
      const asking = questItems.get(row.item);
      if (asking !== undefined) {
        out.warnings.push(`${label}: item ${row.item} is one quest ${asking} asks for, so its drops are set in that quest's Objectives, not in the loot list.`);
        continue;
      }
      insert(table, {
        Entry: text(entry), Item: text(row.item), Reference: '0', Chance: text(row.chance), QuestRequired: row.questOnly ? '1' : '0',
        LootMode: '1', GroupId: '0', MinCount: text(row.min), MaxCount: text(row.max), Comment: lootTag,
      });
      lootKeys[table].set(`${entry}/${row.item}`, { Entry: text(entry), Item: text(row.item) });
      written += 1;
    }
    return written;
  };
  const out: CompiledScripts = { inserts: {}, deletes: {}, updates: [], flags: [], warnings: [] };
  const insert = (table: string, row: Row): void => {
    (out.inserts[table] ??= []).push(row);
  };
  const writePages = (pages: readonly Page[]): void => {
    pages.forEach((page, i) => {
      insert('page_text', { ID: text(page.id), Text: page.text, NextPageID: text(pages[i + 1]?.id ?? 0) });
    });
  };
  const creatureRows = new Map(context.creatures.map((r) => [num(r.entry), r]));
  const objectRows = new Map(context.gameobjects.map((r) => [num(r.entry), r]));

  const creatureGuids = new Set<number>();
  const objectGuids = new Set<number>();

  for (const npc of entities.npcs) {
    const existing = creatureRows.get(npc.entry);
    const lootWritten = writeLoot('creature_loot_template', npc.entry, npc.loot, `NPC "${npc.name || npc.entry}"`);
    const npcflag =
      (npc.questGiver || givers.includes(npc.entry) ? QUEST_GIVER_BIT : 0) |
      (npc.gossip ? GOSSIP_BIT : 0) |
      (num(existing?.npcflag) & GOSSIP_BIT);
    insert('creature_template', {
      entry: text(npc.entry), name: npc.name, subname: npc.subname, minlevel: text(npc.minLevel), maxlevel: text(npc.maxLevel),
      faction: text(npc.faction), npcflag: text(npcflag), rank: text(RANK_VALUE[npc.rank]), type: text(NPC_TYPE_VALUE[npc.type]),
      HealthModifier: text(npc.healthModifier), DamageModifier: text(npc.damageModifier), unit_class: text(UNIT_CLASS),
      // A fight or things to do on its patrol run on SmartAI; otherwise keep what quest scripting may have set.
      AIName: fightIsEmpty(npc.fight) && !hasPointActions(npc) ? (existing?.AIName ?? '') : 'SmartAI', gossip_menu_id: existing?.gossip_menu_id ?? '0',
      // Creature loot is looked up by `lootid`; the NPC's own entry keeps its loot rows its own.
      ...(lootWritten > 0 ? { lootid: text(npc.entry) } : {}),
    });
    insert('creature_template_model', {
      CreatureID: text(npc.entry), Idx: '0', CreatureDisplayID: text(npc.displayId), DisplayScale: text(npc.scale), Probability: '1',
    });
    const { mainHand, offHand, ranged } = npc.equipment;
    const armed = mainHand > 0 || offHand > 0 || ranged > 0;
    if (armed) {
      insert('creature_equip_template', { CreatureID: text(npc.entry), ID: '1', ItemID1: text(mainHand), ItemID2: text(offHand), ItemID3: text(ranged) });
    }
    for (const spawn of npc.spawns) {
      creatureGuids.add(spawn.guid);
      const patrol = walking(spawn.patrol) ? spawn.patrol : null;
      insert('creature', {
        // Stock AzerothCore calls the spawn's NPC `id1`, older forks `id`; the export keeps the one the database has.
        guid: text(spawn.guid), id: text(npc.entry), id1: text(npc.entry), map: text(spawn.map), spawnMask: '1', phaseMask: '1',
        position_x: text(spawn.x), position_y: text(spawn.y), position_z: text(spawn.z), orientation: text(spawn.o),
        spawntimesecs: text(spawn.respawnSecs),
        wander_distance: text(patrol ? 0 : spawn.wander),
        MovementType: text(patrol ? MOVEMENT_TYPE.path : spawn.wander > 0 ? MOVEMENT_TYPE.wander : MOVEMENT_TYPE.idle),
        // A spawn holds no weapons unless it names the equipment row: 0 means none.
        equipment_id: armed ? '1' : '0',
        Comment: entityTag('npc', npc.entry),
      });
      if (patrol) {
        insert('creature_addon', { guid: text(spawn.guid), path_id: text(patrol.pathId) });
        for (const row of routeRows(patrol, spawn)) insert('waypoint_data', row);
      }
    }
  }

  for (const object of entities.objects) {
    const existing = objectRows.get(object.entry);
    const row: Row = {
      entry: text(object.entry), type: text(OBJECT_TYPE_VALUE[object.type]), displayId: text(object.displayId), name: object.name,
      size: text(object.size), AIName: existing?.AIName ?? '',
    };
    // A chest's loot is looked up by `Data1`; using its own entry keeps its loot rows its own.
    if (object.type === 'chest') row.Data1 = text(object.entry);
    // The page an object opens when used: a readable object's `Data0`, a usable object's `Data7`.
    const firstPage = object.pages[0]?.id;
    if (firstPage !== undefined && object.type === 'text') row.Data0 = text(firstPage);
    if (firstPage !== undefined && object.type === 'goober') row.Data7 = text(firstPage);
    // Only players with the quest in their log may use it (goober `Data1`) or loot it (chest `Data8`).
    if (object.onlyDuringQuest !== null && object.type === 'goober') row.Data1 = text(object.onlyDuringQuest);
    if (object.onlyDuringQuest !== null && object.type === 'chest') row.Data8 = text(object.onlyDuringQuest);
    insert('gameobject_template', row);
    if (object.type === 'chest') writeLoot('gameobject_loot_template', object.entry, object.loot, `Object "${object.name || object.entry}"`);
    else if (object.loot.length > 0) out.warnings.push(`Object "${object.name || object.entry}": only a chest can be looted, so its loot list is not written.`);
    writePages(object.pages);
    for (const spawn of object.spawns) {
      objectGuids.add(spawn.guid);
      insert('gameobject', {
        guid: text(spawn.guid), id: text(object.entry), map: text(spawn.map), spawnMask: '1', phaseMask: '1',
        position_x: text(spawn.x), position_y: text(spawn.y), position_z: text(spawn.z), orientation: text(spawn.o),
        // Tilted in the 3D view: its whole rotation; otherwise turned about Z by its facing alone
        ...(spawn.rotation
          ? { rotation0: text(round6(spawn.rotation[0])), rotation1: text(round6(spawn.rotation[1])), rotation2: text(round6(spawn.rotation[2])), rotation3: text(round6(spawn.rotation[3])) }
          : { rotation0: '0', rotation1: '0', rotation2: text(round6(Math.sin(spawn.o / 2))), rotation3: text(round6(Math.cos(spawn.o / 2))) }),
        spawntimesecs: text(spawn.respawnSecs), animprogress: text(ANIM_FULL), state: text(GO_READY),
        Comment: entityTag('obj', object.entry),
      });
    }
  }

  for (const item of entities.items) {
    insert('item_template', itemRow(item));
    writePages(item.pages);
    if (!input.itemColumns) continue;
    const label = item.name.trim() ? `Item "${item.name.trim()}"` : `Item ${item.entry}`;
    for (const column of Object.keys(item.advanced)) {
      if (MODELLED_ITEM_COLUMNS.has(column) || input.itemColumns.has(column)) continue;
      out.warnings.push(`${label}: the database has no item_template column ${column}, so its value is not written.`);
    }
  }

  // Every key the project holds, plus spawns a past export placed and the author since removed, found by
  // the entity's tag or the quest tag exports before version 4 wrote. Only spawns of an NPC or object
  // still in the project: like its template, the spawns of one the project no longer has are left alone.
  const spawnOwner = (comment: string | null | undefined): { kind: string; entry: number } | null => {
    const tagged = entityOf(comment);
    if (tagged && tagged.rest === '') return tagged;
    const legacy = typeof comment === 'string' ? LEGACY_SPAWN_TAG.exec(comment) : null;
    return legacy ? { kind: legacy[1]!, entry: Number(legacy[2]) } : null;
  };
  const npcEntriesHeld = new Set(entities.npcs.map((n) => n.entry));
  const objectEntriesHeld = new Set(entities.objects.map((o) => o.entry));
  for (const row of context.taggedCreatureSpawns) {
    const owner = spawnOwner(row.Comment);
    if (owner?.kind === 'npc' && npcEntriesHeld.has(owner.entry)) creatureGuids.add(num(row.guid));
  }
  for (const row of context.taggedObjectSpawns) {
    const owner = spawnOwner(row.Comment);
    if (owner?.kind === 'obj' && objectEntriesHeld.has(owner.entry)) objectGuids.add(num(row.guid));
  }
  const sorted = (values: Iterable<number>): number[] => [...new Set(values)].sort((a, b) => a - b);
  const add = (table: string, keys: Row[]): void => {
    if (keys.length > 0) out.deletes[table] = keys;
  };
  add('creature_template', sorted(entities.npcs.map((n) => n.entry)).map((e) => ({ entry: text(e) })));
  add('creature_template_model', sorted(entities.npcs.map((n) => n.entry)).map((e) => ({ CreatureID: text(e), Idx: '0' })));
  add('creature_equip_template', sorted(entities.npcs.map((n) => n.entry)).map((e) => ({ CreatureID: text(e), ID: '1' })));
  add('creature', sorted(creatureGuids).map((g) => ({ guid: text(g) })));
  add('gameobject_template', sorted(entities.objects.map((o) => o.entry)).map((e) => ({ entry: text(e) })));
  add('gameobject', sorted(objectGuids).map((g) => ({ guid: text(g) })));
  add('item_template', sorted(entities.items.map((i) => i.entry)).map((e) => ({ entry: text(e) })));
  add('page_text', sorted([...entities.objects, ...entities.items].flatMap((o) => o.pages.map((p) => p.id))).map((id) => ({ ID: text(id) })));
  // Patrols: the addon and route of every spawn this quest has or had, whether it still patrols or not.
  const addonGuids = new Set<number>((out.inserts.creature_addon ?? []).map((r) => num(r.guid)));
  const ownedPaths = new Set<number>();
  for (const npc of entities.npcs) for (const spawn of npc.spawns) if (spawn.patrol) ownedPaths.add(spawn.patrol.pathId);
  for (const row of context.addons) {
    if (!creatureGuids.has(num(row.guid))) continue;
    addonGuids.add(num(row.guid));
    if (num(row.path_id) > 0) ownedPaths.add(num(row.path_id));
  }
  add('creature_addon', sorted(addonGuids).map((g) => ({ guid: text(g) })));
  const points = new Map<string, Row>();
  for (const row of [...context.waypointRows.filter((r) => ownedPaths.has(num(r.id))), ...(out.inserts.waypoint_data ?? [])]) {
    points.set(`${num(row.id)}/${num(row.point)}`, { id: text(num(row.id)), point: text(num(row.point)) });
  }
  add('waypoint_data', [...points.values()].sort((a, b) => num(a.id) - num(b.id) || num(a.point) - num(b.point)));
  // Loot rows written before and since removed, for NPCs and chests the project still has.
  const npcEntries = new Set(entities.npcs.map((n) => n.entry));
  const chestEntries = new Set(entities.objects.filter((o) => o.type === 'chest').map((o) => o.entry));
  for (const [table, rows, owned] of [
    ['creature_loot_template', context.taggedLoot.creature, npcEntries],
    ['gameobject_loot_template', context.taggedLoot.gameobject, chestEntries],
  ] as const) {
    const kind = table === 'creature_loot_template' ? 'npc' : 'obj';
    for (const r of rows) {
      const ours = r.Comment === entityLootTag(kind, num(r.Entry)) || LEGACY_LOOT_TAG.test(r.Comment ?? '');
      if (!ours || !owned.has(num(r.Entry))) continue;
      lootKeys[table].set(`${num(r.Entry)}/${num(r.Item)}`, { Entry: text(num(r.Entry)), Item: text(num(r.Item)) });
    }
    const keys = [...lootKeys[table].values()].sort((a, b) => num(a.Entry) - num(b.Entry) || num(a.Item) - num(b.Item));
    add(table, keys);
  }
  return out;
}
