import { isDeepStrictEqual } from 'node:util';
import { layoutChain, NODE_GRID } from '../../core/canvas/layout';
import { allocateQuestId, collectTakenIds } from '../../core/ids/allocator';
import { createNewAggregate } from '../../core/import/new-quest';
import { findQuestChain, MAX_CHAIN_QUESTS } from '../../core/import/quest-chain';
import { listUnmodelled } from '../../core/import/unmodelled';
import { componentById } from '../../core/links/catalog';
import type { NameBook, NameKind } from '../../core/links/component';
import { rowsOrNone } from '../../core/links/context';
import { disconnectedQuests, linkIssues } from '../../core/links/issues';
import { questEdges, type ComponentId, type Endpoint } from '../../core/links/model';
import { loadLinks } from '../../core/links/service';
import type { QuestAggregate } from '../../core/model/aggregate';
import { localesInSnapshot, localizedTextValues } from '../../core/model/locales';
import { registry } from '../../core/registry';
import { actionName, describeEvent } from '../../core/smartai/ids';
import { sourceEndpoint } from '../../core/links/components/smartai';
import { endpointName } from '../../core/links/describe';
import { compareTables } from '../../core/roundtrip/compare';
import type { FidelityReport } from '../../core/roundtrip/verify';
import { validateQuest } from '../../core/validate/validate';
import { projectQuestFacts } from '../world/groups-api';
import type { CanvasNode, NodeGroup, NodeLink, NodePosition, OpenResult, QuestLinks, QuestsApi, StartBadge } from '../../shared/ipc';
import { listIdsOf, taggedRows } from '../../core/scripts/context';
import { foreignScenes, scenesFromRows } from '../../core/scripts/decompile';
import { SCRIPTS_FIELD, readScenes, writeScenes, type QuestScene, type SceneOwner } from '../../core/scripts/model';
import { objectivesOf, questRefs, questUses, relationOwners } from '../../core/entities/links';
import type { Services } from './services';
import { fail, run } from './errors';
import type { Session } from './connection';
import { roundTripOf, KEY_COLUMNS } from './patches';

export const TITLE_FIELD = 'quest_template.LogTitle';
const LEVEL_FIELD = 'quest_template.QuestLevel';

export const textOf = (aggregate: QuestAggregate, fieldId: string): string => {
  const value = aggregate.values[fieldId];
  return typeof value === 'string' ? value : '';
};

const numberOf = (aggregate: QuestAggregate, fieldId: string): number => {
  const value = aggregate.values[fieldId];
  return typeof value === 'number' ? value : 0;
};

/**
 * The start components a canvas node shows as a badge, in the order the node draws them.
 * `start.offeredStraightAway` is missing on purpose: it comes from another quest, so it is an edge.
 */
const START_BADGES: readonly [ComponentId, StartBadge][] = [
  ['start.npc', 'npc'],
  ['start.object', 'object'],
  ['start.gameEvent', 'event'],
  ['start.item', 'item'],
  ['start.smartai', 'script'],
  ['start.backend', 'backend'],
];

const GROUP_KINDS: Partial<Record<ComponentId, NodeGroup['kind']>> = {
  'group.pickOne': 'pickOne',
  'group.finishAll': 'finishAll',
};

/** The world entity an endpoint names, when it is one the links panel can show a name for. */
function nameTarget(endpoint: Endpoint): [NameKind, number] | undefined {
  switch (endpoint.kind) {
    case 'quest':
      return ['quest', endpoint.questId];
    case 'creature':
    case 'gameobject':
    case 'item':
      return [endpoint.kind, endpoint.entry];
    default:
      return undefined;
  }
}

/** Quests on the canvas: opening, making, laying out, linking, editing and checking them */
export function createQuestsApi(s: Services): QuestsApi {
  const { deps, connected, usable, quests, asOneStep, questOf, placeAt, withProjectStarters, linksFor, projectEntities, refsFor, missingScriptTables } = s.ctx;
  const { issuesOf } = s.checks;
  const { importWithScenes } = s.patches;

  /** Opens one quest: the project's copy if it has one, otherwise a fresh import placed on the canvas. */
  async function openOne(questId: number, position?: NodePosition): Promise<OpenResult> {
    const live = usable();
    const refs = refsFor(live);
    const quest = quests.get(questId);

    // A brand-new quest (never exported) has no row in the live database to import or diff
    // against — asking the importer for it would fail outright, so the project's copy alone is opened.
    if (quest?.isNew) {
      return {
        questId,
        aggregate: quest.aggregate,
        fidelity: quest.fidelity ?? { ok: true },
        unmodelled: [],
        issues: await issuesOf(live, questId, quest.aggregate, refs),
        inProject: true,
        stale: false,
        locales: [],
        importedText: {},
      };
    }

    // The importer is the one place that decides what a usable quest ID is.
    const fresh = await importWithScenes(live, questId);
    const fidelity = roundTripOf(fresh, live.schema);
    const unmodelled = listUnmodelled(live.schema, registry, fresh.snapshot);
    // Both branches report the translations against the rows just read, never against the edit.
    const locales = localesInSnapshot(fresh.snapshot);
    const importedText = localizedTextValues(fresh.aggregate, registry);

    if (quest) {
      // The project's copy is the user's work: it is returned as it stands, wherever it sits, and only
      // the comparison against the freshly read rows says whether the world moved underneath.
      const stale = compareTables(quest.snapshot?.tables ?? {}, fresh.snapshot.tables, KEY_COLUMNS).length > 0;
      // The export gate reads `quest.fidelity`, so the report the UI is about to show has to
      // become the stored one: otherwise the button and the gate answer different questions.
      if (JSON.stringify(quest.fidelity) !== JSON.stringify(fidelity)) {
        // Not an edit: the user changed nothing, so the project is not marked unsaved.
        quests.put({ ...quest, fidelity }, { quiet: true });
      }
      return {
        questId,
        aggregate: quest.aggregate,
        fidelity,
        unmodelled,
        issues: await issuesOf(live, questId, quest.aggregate, refs),
        inProject: true,
        stale,
        locales,
        importedText,
      };
    }

    const at = placeAt(position);
    quests.put({
      questId,
      isNew: false,
      aggregate: fresh.aggregate,
      snapshot: fresh.snapshot,
      fidelity,
      x: at.x,
      y: at.y,
      lastExportPath: null,
    });
    return {
      questId,
      aggregate: fresh.aggregate,
      fidelity,
      unmodelled,
      issues: await issuesOf(live, questId, fresh.aggregate, refs),
      inProject: false,
      stale: false,
      locales,
      importedText,
    };
  }
  return {
    openQuest: (questId, position) => run(async () => openOne(questId, position)),

    addQuestChain: (questId, position) =>
      // The picked quest and every quest chained to it are one step
      run(() => asOneStep(async () => {
        const live = usable();
        const chain = await findQuestChain(live.db, questId, MAX_CHAIN_QUESTS, undefined, withProjectStarters(live.itemStarters));
        const slots = layoutChain(chain.questIds, chain.links);
        const rootSlot = slots.get(questId) ?? { column: 0, row: 0 };

        // The picked quest lands where it was asked for; with no position, the chain starts in
        // the first column below everything already on the canvas, so it never lands on top of it.
        const onCanvas = quests.list();
        const origin = position
          ? { x: position.x - rootSlot.column * NODE_GRID.x, y: position.y - rootSlot.row * NODE_GRID.y }
          : { x: 0, y: onCanvas.length === 0 ? 0 : Math.max(...onCanvas.map((q) => q.y)) + NODE_GRID.y };
        const at = (id: number): NodePosition => {
          const slot = slots.get(id) ?? rootSlot;
          return { x: origin.x + slot.column * NODE_GRID.x, y: origin.y + slot.row * NODE_GRID.y };
        };

        // The picked quest first: if it cannot be opened, nothing else is added either.
        const open = await openOne(questId, at(questId));
        for (const id of chain.questIds) {
          if (id === questId || quests.get(id)) continue;
          const fresh = await importWithScenes(live, id);
          const place = at(id);
          quests.put({
            questId: id,
            isNew: false,
            aggregate: fresh.aggregate,
            snapshot: fresh.snapshot,
            fidelity: roundTripOf(fresh, live.schema),
            x: place.x,
            y: place.y,
            lastExportPath: null,
          });
        }
        return { open, questIds: chain.questIds, truncated: chain.truncated };
      })),

    newQuest: (position) =>
      run(async () => {
        const live = usable();
        const meta = deps.session.meta();
        const range = { start: meta.idRangeStart, end: meta.idRangeEnd };
        const taken = await collectTakenIds(live.db, range, quests.usedQuestIds());
        const questId = allocateQuestId(range, taken);
        const created = createNewAggregate(live.schema, registry, questId);
        const aggregate = {
          ...created,
          values: { ...created.values, [SCRIPTS_FIELD]: writeScenes([]) },
        };
        const fidelity: FidelityReport = { ok: true };

        const at = placeAt(position);
        // Adding it to the project straight away is what reserves the ID against the next allocation.
        quests.put({
          questId,
          isNew: true,
          aggregate,
          snapshot: null,
          fidelity,
          x: at.x,
          y: at.y,
          lastExportPath: null,
        });
        return {
          questId,
          aggregate,
          fidelity,
          unmodelled: [],
          issues: await issuesOf(live, questId, aggregate, refsFor(live)),
          inProject: false,
          stale: false,
          // A quest that does not exist yet has no translations to leave behind.
          locales: [],
          importedText: {},
        };
      }),

    listNodes: () =>
      run(async () => {
        const live = connected();
        // One checker for the whole canvas: the same NPC or item is asked about once, not per node.
        const refs = refsFor(live);
        const projectQuests = quests.list();
        const store = projectEntities();
        const canvasIds = projectQuests.map((d) => d.questId);
        const onCanvas = new Set(canvasIds);
        // One link snapshot for the whole canvas, so the context is read once rather than per node.
        const snapshot = await loadLinks(
          live.db,
          canvasIds,
          new Map(projectQuests.map((d) => [d.questId, d.aggregate])),
          live.availability.available,
          withProjectStarters(live.itemStarters),
        );
        const disconnected = disconnectedQuests(canvasIds, snapshot);
        const edges = snapshot.result.instances.flatMap((instance) =>
          questEdges(instance).map((edge) => ({ ...edge, instance })),
        );

        // A link to a quest that is not drawn is only worth counting when that quest is real, and
        // the existence check is one batched read rather than one per neighbour.
        const offCanvas = new Set<number>();
        for (const { from, to } of edges) {
          if (onCanvas.has(from) && !onCanvas.has(to)) offCanvas.add(to);
          if (onCanvas.has(to) && !onCanvas.has(from)) offCanvas.add(from);
        }
        const existing = offCanvas.size > 0 ? await live.db.existingIds('quest', [...offCanvas]) : new Set<number>();

        const nodes: CanvasNode[] = [];
        for (const quest of projectQuests) {
          const questId = quest.questId;
          const issues = [...(await validateQuest(quest.aggregate, refs)), ...linkIssues(questId, snapshot)];
          const notConnected = disconnected.has(questId);
          const facts = projectQuestFacts(quest);

          const links = new Map<string, NodeLink>();
          const neighbours = new Set<number>();
          for (const { from, to, instance } of edges) {
            if (from === questId) {
              links.set(`${to}/${instance.component}`, { to, component: instance.component, owner: instance.owner });
              if (!onCanvas.has(to)) neighbours.add(to);
            }
            if (to === questId && !onCanvas.has(from)) neighbours.add(from);
          }

          const startedBy = new Set<ComponentId>();
          const groups: NodeGroup[] = [];
          for (const instance of snapshot.result.instances) {
            if (
              instance.to.kind === 'quest'
              && instance.to.questId === questId
              && componentById(instance.component).hook === 'start'
            ) {
              startedBy.add(instance.component);
            }
            const kind = GROUP_KINDS[instance.component];
            const members = instance.params.members;
            if (kind && Array.isArray(members) && members.includes(questId)) {
              groups.push({ group: instance.params.group as number, kind });
            }
          }

          nodes.push({
            questId,
            title: textOf(quest.aggregate, TITLE_FIELD),
            level: numberOf(quest.aggregate, LEVEL_FIELD),
            isNew: quest.isNew,
            exported: quest.lastExportPath !== null,
            unsafe: quest.fidelity !== null && !quest.fidelity.ok,
            errors: issues.filter((i) => i.severity === 'error').length,
            warnings: issues.filter((i) => i.severity === 'warning').length + (notConnected ? 1 : 0),
            x: quest.x,
            y: quest.y,
            links: [...links.values()].sort((a, b) => a.to - b.to || a.component.localeCompare(b.component, 'en')),
            starts: START_BADGES.filter(([component]) => startedBy.has(component)).map(([, badge]) => badge),
            groups,
            offCanvasLinks: [...neighbours].filter((id) => existing.has(id)).length,
            notConnected,
            uses: questUses(quest, store),
            refs: questRefs(quest),
            daily: facts.daily,
            weekly: facts.weekly,
          });
        }
        return nodes;
      }),

    moveNodes: (moves) =>
      run(async () => {
        connected();
        quests.setPositions(moves);
        return true as const;
      }),

    removeNode: (questId) =>
      run(async () => {
        connected();
        // Removing a node the user already removed is not an error; the canvas ends up the same.
        quests.remove(questId);
        return true as const;
      }),

    saveViewport: (viewport) =>
      run(async () => {
        connected();
        deps.session.setViewport(viewport);
        return true as const;
      }),

    questLinks: (questIds) =>
      run(async (): Promise<QuestLinks> => {
        const live = connected();
        const { instances, unrecognised } = (await linksFor(live, questIds)).result;

        // Every name a description could ask for, looked up in one read per kind.
        const wanted = new Map<NameKind, Set<number>>();
        const want = (kind: NameKind, id: number): void => {
          const ids = wanted.get(kind) ?? new Set<number>();
          ids.add(id);
          wanted.set(kind, ids);
        };
        for (const instance of instances) {
          for (const endpoint of [instance.from, instance.to]) {
            const target = nameTarget(endpoint);
            if (target) want(...target);
          }
          const { members, then } = instance.params;
          if (Array.isArray(members)) for (const id of members) want('quest', id);
          if (typeof then === 'number' && then > 0) want('quest', then);
        }
        for (const { row } of unrecognised) {
          const target = nameTarget(sourceEndpoint(row));
          if (target) want(...target);
        }
        const found = new Map<NameKind, Map<number, string>>();
        for (const [kind, ids] of wanted) found.set(kind, await live.db.lookupNames(kind, [...ids]));
        const names: NameBook = (kind, id) => found.get(kind)?.get(id);

        return {
          instances: instances.map((instance) => {
            const component = componentById(instance.component);
            return { ...instance, label: component.label, summary: component.describe(instance, names) };
          }),
          unrecognised: unrecognised.map(({ questId, ref, row }) => ({
            questId,
            key: ref.key,
            summary: `${describeEvent(row)}: ${actionName(row.actionType)} (${endpointName(sourceEndpoint(row), names)}, row ${row.id})`,
          })),
          unavailable: live.availability.unavailable,
        };
      }),

    updateQuest: (aggregate) =>
      run(async () => {
        connected();
        const quest = questOf(aggregate.questId);
        // Closing the editor sends the quest back as it is; that is not an edit to the project.
        if (isDeepStrictEqual(quest.aggregate, aggregate)) return true as const;
        // The snapshot and the fidelity report belong to the import, not to the edit.
        quests.put({ ...quest, aggregate });
        return true as const;
      }),

    questScripts: (questId) =>
      run(async () => {
        const live = connected();
        const aggregate = questOf(questId).aggregate;
        const creatures = new Set<number>();
        const objects = new Set<number>();
        const areas = new Set<number>();
        const addOwner = (owner: SceneOwner): void => {
          if (owner.kind === 'creature' && owner.entry > 0) creatures.add(owner.entry);
          else if (owner.kind === 'gameobject' && owner.entry > 0) objects.add(owner.entry);
          else if (owner.kind === 'areatrigger' && owner.id > 0) areas.add(owner.id);
        };
        readScenes(aggregate.values).forEach((s: QuestScene) => addOwner(s.owner));
        [...relationOwners(aggregate, 'starter'), ...relationOwners(aggregate, 'ender')].forEach(addOwner);
        for (const entry of objectivesOf(aggregate)) {
          if (entry > 0) creatures.add(entry);
          else if (entry < 0) objects.add(-entry);
        }
        const ids = (set: ReadonlySet<number>): string[] => [...set].map(String);
        const [onCreatures, onObjects, onAreas, lists, tagged] = await Promise.all([
          rowsOrNone(live.db, 'smart_scripts', { source_type: '0', entryorguid: ids(creatures) }),
          rowsOrNone(live.db, 'smart_scripts', { source_type: '1', entryorguid: ids(objects) }),
          rowsOrNone(live.db, 'smart_scripts', { source_type: '2', entryorguid: ids(areas) }),
          rowsOrNone(live.db, 'smart_scripts', { source_type: '9', entryorguid: listIdsOf([...creatures, ...objects]) }),
          taggedRows(live.db, 'smart_scripts', 'comment', questId),
        ]);
        return {
          foreign: foreignScenes(questId, [...onCreatures, ...onObjects, ...onAreas, ...lists]),
          unreadable: scenesFromRows(questId, tagged).unreadable,
          missingTables: missingScriptTables(live),
        };
      }),

    validate: (questId) =>
      run(async () => {
        const live = connected();
        return issuesOf(live, questId, questOf(questId).aggregate, refsFor(live));
      }),
  };
}
