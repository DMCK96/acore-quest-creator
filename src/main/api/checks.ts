import { assertIdFree } from '../../core/ids/allocator';
import { rowsOrNone } from '../../core/links/context';
import { objectMenus } from '../../core/db/object-menus';
import { linkIssues } from '../../core/links/issues';
import type { QuestAggregate } from '../../core/model/aggregate';
import { validateQuest, type Issue, type RefChecker } from '../../core/validate/validate';
import { groupsOf } from '../../core/world/layer';
import { validateGroup } from '../../core/world/groups';
import { groupContext } from '../world/groups-api';
import { readScenes } from '../../core/scripts/model';
import { sceneIssues } from '../../core/scripts/validate';
import { objectivesOf, questItemsOf, relationOwners } from '../../core/entities/links';
import type { ProjectEntities } from '../../core/entities/model';
import { entityIssues } from '../../core/entities/validate';
import type { ProjectQuest } from '../project/project-file';
import type { ApiContext } from './context';
import type { Session } from './connection';
import { fail } from './errors';
import type { ServerFiles } from './server-files';

/** What stops a quest or the project being exported: validation, the round-trip gate and free ids */
export function createChecks(ctx: ApiContext, files: ServerFiles) {
  const { deps, quests, linksFor, projectEntities, questEntities, refsFor, objectivesByQuest, missingScriptTables } = ctx;

  /**
   * A quest's own validation plus what its links say about it. Only for display: the export gate
   * reads errors alone and link issues are warnings, so `guardWrite` has no use for them.
   */
  async function issuesOf(live: Session, questId: number, aggregate: QuestAggregate, refs: RefChecker): Promise<Issue[]> {
    const own = await validateQuest(aggregate, refs);
    return [
      ...own,
      ...(await scriptIssues(live, aggregate)),
      ...(await newEntityIssues(live, questEntities(aggregate))),
      ...linkIssues(questId, await linksFor(live, [questId])),
    ];
  }

  /** The scene issues of a quest, which need the owners' templates to tell whether a C++ script runs them. */
  async function scriptIssues(live: Session, aggregate: QuestAggregate): Promise<Issue[]> {
    const scenes = readScenes(aggregate.values);
    if (scenes.length === 0) return [];
    const creatures = scenes.flatMap((s) => (s.owner.kind === 'creature' && s.owner.entry > 0 ? [String(s.owner.entry)] : []));
    const objects = scenes.flatMap((s) => (s.owner.kind === 'gameobject' && s.owner.entry > 0 ? [String(s.owner.entry)] : []));
    const [creatureRows, objectRows] = await Promise.all([
      rowsOrNone(live.db, 'creature_template', { entry: creatures }),
      rowsOrNone(live.db, 'gameobject_template', { entry: objects }),
    ]);
    const cppOwners = [
      ...creatureRows.filter((r) => (r.ScriptName ?? '') !== '' && r.AIName !== 'SmartAI').map((r) => `creature:${r.entry}`),
      ...objectRows.filter((r) => (r.ScriptName ?? '') !== '' && r.AIName !== 'SmartGameObjectAI').map((r) => `gameobject:${r.entry}`),
    ];
    const flags = aggregate.values['quest_template_addon.SpecialFlags'];
    return sceneIssues({
      questId: aggregate.questId,
      scenes,
      objectives: objectivesOf(aggregate),
      givers: relationOwners(aggregate, 'starter'),
      enders: relationOwners(aggregate, 'ender'),
      cppOwners,
      missingTables: missingScriptTables(live),
      specialFlags: typeof flags === 'number' ? flags : 0,
    });
  }

  async function newEntityIssues(live: Session, entities: ProjectEntities): Promise<Issue[]> {
    if (entities.npcs.length + entities.objects.length + entities.items.length === 0) return [];
    const startedQuests = [...new Set(entities.items.map((i) => i.startsQuest).filter((q) => q > 0))];
    const [creatures, objects, itemRows, questRows] = await Promise.all([
      rowsOrNone(live.db, 'creature_template', { entry: entities.npcs.map((n) => String(n.entry)) }),
      rowsOrNone(live.db, 'gameobject_template', { entry: entities.objects.map((o) => String(o.entry)) }),
      rowsOrNone(live.db, 'item_template', { entry: entities.items.map((i) => String(i.entry)) }),
      rowsOrNone(live.db, 'quest_template', { ID: startedQuests.map(String) }),
    ]);
    const dbNames = new Map<string, string>([
      ...creatures.map((r) => [`creature:${r.entry}`, r.name ?? ''] as [string, string]),
      ...objects.map((r) => [`gameobject:${r.entry}`, r.name ?? ''] as [string, string]),
      ...itemRows.map((r) => [`item:${r.entry}`, r.name ?? ''] as [string, string]),
    ]);
    const knownQuests = new Set([...questRows.map((r) => Number(r.ID)), ...quests.usedQuestIds()]);
    const itemColumnTypes = new Map((live.scriptSchema.tables.item_template ?? []).map((c) => [c.name, c.dataType]));
    // Only a spell list already loaded: a validation run must not wait for, or start, the big read.
    const spells = live.spellsReady;
    const held = [...new Set(entities.npcs.flatMap((n) => [n.equipment.mainHand, n.equipment.offHand, n.equipment.ranged]).filter((i) => i > 0))];
    const items = held.length > 0 ? await rowsOrNone(live.db, 'item_template', { entry: held.map(String) }) : [];
    const itemInventoryTypes = new Map(items.map((r) => [Number(r.entry), Number(r.InventoryType ?? 0)]));
    // What NPCs sell: an item the world database or the project has
    const sold = [...new Set(entities.npcs.flatMap((n) => n.vendor.map((v) => v.item)).filter((i) => i > 0))];
    const soldRows = sold.length > 0 ? await rowsOrNone(live.db, 'item_template', { entry: sold.map(String) }) : [];
    // Who in the database uses each trainer id a project NPC holds or was read with, to tell an id that is its own from another NPC's
    const readId = (n: (typeof entities.npcs)[number]): number => (n.origin.kind === 'existing' ? Number(n.origin.original.creature_default_trainer?.[0]?.TrainerId ?? 0) : 0);
    const trainerIds = [...new Set(entities.npcs.flatMap((n) => [n.trainer?.trainerId ?? 0, readId(n)]).filter((id) => id > 0))];
    const trainerLinks = trainerIds.length > 0 ? await rowsOrNone(live.db, 'creature_default_trainer', { TrainerId: trainerIds.map(String) }) : [];
    const trainerUsers = new Map<number, number[]>();
    for (const r of trainerLinks) trainerUsers.set(Number(r.TrainerId), [...(trainerUsers.get(Number(r.TrainerId)) ?? []), Number(r.CreatureId)]);
    // Who in the database uses the gossip menus and texts the project's NPCs hold or point at, and whether the menus their options open exist
    const trees = entities.npcs.flatMap((n) => n.gossipMenu?.menus ?? []);
    const roots = entities.npcs.flatMap((n) => (n.origin.kind === 'existing' ? (n.origin.original.gossip_menu ?? []).map((r) => Number(r.MenuID)) : []));
    const opened = trees.flatMap((m) => m.options.flatMap((o) => (o.action.kind === 'menu' ? [o.action.menuId] : [])));
    const menuIds = [...new Set([...trees.map((m) => m.menuId), ...roots, ...opened].filter((id) => id > 0))];
    const textIds = [...new Set(trees.map((m) => m.textId).filter((id) => id > 0))];
    const [menuCreatures, menuObjects, menuRows, optionRows, textUsers] = await Promise.all([
      menuIds.length > 0 ? rowsOrNone(live.db, 'creature_template', { gossip_menu_id: menuIds.map(String) }) : [],
      menuIds.length > 0 ? objectMenus(live.db, menuIds.map(String)) : [],
      menuIds.length > 0 ? rowsOrNone(live.db, 'gossip_menu', { MenuID: menuIds.map(String) }) : [],
      menuIds.length > 0 ? rowsOrNone(live.db, 'gossip_menu_option', { MenuID: menuIds.map(String) }) : [],
      textIds.length > 0 ? rowsOrNone(live.db, 'gossip_menu', { TextID: textIds.map(String) }) : [],
    ]);
    const menuUsers = new Map<number, { creatures: number[]; objects: number }>();
    const usersOf = (id: number) => menuUsers.get(id) ?? menuUsers.set(id, { creatures: [], objects: 0 }).get(id)!;
    for (const r of menuCreatures) usersOf(Number(r.gossip_menu_id)).creatures.push(Number(r.entry));
    for (const menu of menuObjects) usersOf(menu).objects += 1;
    const textMenus = new Map<number, number[]>();
    for (const r of textUsers) textMenus.set(Number(r.TextID), [...(textMenus.get(Number(r.TextID)) ?? []), Number(r.MenuID)]);
    const haveMenu = new Set([...menuRows, ...optionRows].map((r) => Number(r.MenuID)));
    const gossipFacts = { menuUsers, textMenus, knownMenu: (id: number) => haveMenu.has(id) };
    // Creatures a quest scene gives a gossip option of its own
    const sceneGossipOwners = new Set(quests.list().flatMap((q) => readScenes(q.aggregate.values)).flatMap((s) => (s.trigger.kind === 'gossipOption' && s.owner.kind === 'creature' ? [s.owner.entry] : [])));
    // Extended costs only when some stock asks for one and the server's DBC could be read: a validation run cannot say more
    const asked = entities.npcs.some((n) => n.vendor.some((v) => v.extendedCost > 0));
    const costs = asked ? await files.extendedCostsOf(live) : null;
    const knownItems = new Set([...soldRows.map((r) => Number(r.entry)), ...entities.items.map((i) => i.entry)]);
    return entityIssues({
      entities, dbNames, questItems: [...new Set(quests.list().flatMap((q) => questItemsOf(q.aggregate)))], objectives: objectivesByQuest(),
      knownSpell: spells ? (id) => spells.get(id) !== undefined : null, itemInventoryTypes,
      knownQuest: (id) => knownQuests.has(id), knownItem: (id) => knownItems.has(id), trainerUsers, gossipFacts, sceneGossipOwners,
      knownExtendedCost: costs && !('reason' in costs) ? (id) => costs.get(id) !== undefined : null, itemColumnTypes: itemColumnTypes.size > 0 ? itemColumnTypes : null,
    });
  }

  /** The project's NPCs, objects and items checked; throws when they have errors */
  async function guardProject(live: Session): Promise<void> {
    const issues = await newEntityIssues(live, projectEntities());
    if (issues.some((i) => i.severity === 'error')) {
      throw fail('VALIDATION', "Fix the errors on the project's NPCs, objects and items first.", { issues });
    }
    const groupIssues = await layerGroupIssues(live);
    if (groupIssues.length > 0) throw fail('VALIDATION', 'Fix the spawn groups first.', { issues: groupIssues });
  }

  /** Why each spawn group in the world layer (but the removed ones) would be refused, each named by its group */
  async function layerGroupIssues(live: Session): Promise<Issue[]> {
    const layer = deps.session.world.get();
    const store = projectEntities();
    const issues: Issue[] = [];
    for (const group of groupsOf(layer).filter((g) => !g.removed)) {
      const reasons = validateGroup(group, await groupContext(live.db, layer, store, [], group, quests.list()));
      issues.push(...reasons.map((reason): Issue => ({ severity: 'error', code: 'GROUP', message: `${group.name}: ${reason}` })));
      // Applying a new group deletes the rows of a pool with its id, so one the database has gained since is refused
      if (group.origin.kind === 'new' && (await rowsOrNone(live.db, 'pool_template', { entry: [String(group.id)] })).length > 0) {
        issues.push({ severity: 'error', code: 'GROUP', message:
          `Spawn group "${group.name || `Group ${group.id}`}": the database now has a pool with id ${group.id}; open the group and save it again to give it a new id.` });
      }
    }
    return issues;
  }

  /** The three gates every write passes: lossless import, no validation errors, and a free ID. */
  async function guardWrite(live: Session, quest: ProjectQuest): Promise<Issue[]> {
    const db = live.db;
    if (quest.fidelity !== null && !quest.fidelity.ok) {
      throw fail(
        'FIDELITY',
        `Quest ${quest.questId} did not survive the round-trip check, so exporting it could change data the editor never showed.`,
        { differences: quest.fidelity.differences },
      );
    }
    const issues = [
      ...(await validateQuest(quest.aggregate, refsFor(live))),
      ...(await scriptIssues(live, quest.aggregate)),
    ];
    if (issues.some((i) => i.severity === 'error')) {
      throw fail('VALIDATION', 'Fix the errors on this quest before exporting it.', { issues });
    }
    if (quest.isNew) await assertIdFree(db, quest.questId);
    return issues;
  }
  return { issuesOf, scriptIssues, newEntityIssues, guardProject, layerGroupIssues, guardWrite };
}

export type Checks = ReturnType<typeof createChecks>;
