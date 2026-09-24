import type { RawRow } from '../db/types';
import {
  ACTION,
  CONDITION,
  CONDITION_SOURCE_GOSSIP_OPTION,
  CONDITION_SOURCE_SMART_EVENT,
  EVENT,
  SOURCE,
  TARGET,
  TEAM,
  TEXT_TYPE,
} from '../smartai/ids';
import type { ScriptContext } from './context';
import { describeGate, describeStep } from './describe';
import { triggerHasPlayer, type QuestScene, type SceneGate, type SceneStep } from './model';
import { createAllocator, emitTrigger, type Row, type SmartAction } from './rows';
import { isOurs, sceneFromComment, sceneIdOf, sceneTag, triggerComment } from './tag';

/**
 * Scenes to rows. Pure and deterministic: the same scenes against the same context give the same
 * rows, which is what makes an exported patch re-applicable. Rows the tool wrote before are found by
 * their comment tag and deleted; new IDs go around every row the tool does not own.
 */

export interface RowUpdate {
  table: string;
  key: Record<string, string>;
  set: Record<string, string>;
  /** Only update while these columns still hold these values, so a deliberate choice is never undone. */
  onlyIf?: Record<string, string>;
}

export interface FlagSet {
  table: string;
  column: string;
  bit: number;
  key: Record<string, string>;
}

export interface CompiledScripts {
  /** Table -> partial rows (column -> text); the exporter fills the rest with column defaults. */
  inserts: Record<string, Row[]>;
  /** Table -> primary keys of the rows this quest wrote before. */
  deletes: Record<string, Row[]>;
  updates: RowUpdate[];
  flags: FlagSet[];
  warnings: string[];
}

/** Two compilers' rows as one output, in order: the first's rows before the second's. */
export function mergeCompiled(a: CompiledScripts, b: CompiledScripts): CompiledScripts {
  const tables = (x: Record<string, Row[]>, y: Record<string, Row[]>): Record<string, Row[]> => {
    const out: Record<string, Row[]> = {};
    for (const table of new Set([...Object.keys(x), ...Object.keys(y)])) out[table] = [...(x[table] ?? []), ...(y[table] ?? [])];
    return out;
  };
  return {
    inserts: tables(a.inserts, b.inserts),
    deletes: tables(a.deletes, b.deletes),
    updates: [...a.updates, ...b.updates],
    flags: [...a.flags, ...b.flags],
    warnings: [...a.warnings, ...b.warnings],
  };
}

export interface CompileInput {
  questId: number;
  scenes: readonly QuestScene[];
  /** `quest_template.RequiredNpcOrGo` as four signed entries; index 0 is objective 1. */
  objectives: readonly number[];
  context: ScriptContext;
}

const SMART_KEY = ['entryorguid', 'source_type', 'id', 'link'] as const;
const TEXT_KEY = ['CreatureID', 'GroupID', 'ID'] as const;
const WAYPOINT_KEY = ['entry', 'pointid'] as const;
const CONDITION_KEY = [
  'SourceTypeOrReferenceId',
  'SourceGroup',
  'SourceEntry',
  'SourceId',
  'ElseGroup',
  'ConditionTypeOrReference',
  'ConditionTarget',
  'ConditionValue1',
  'ConditionValue2',
  'ConditionValue3',
] as const;

const DATA_MARKER = ' #aqc=';
const GOSSIP_BIT = 1;
const QUEST_GIVER_BIT = 2;
/** `TEMPSUMMON_TIMED_OR_DEAD_DESPAWN` and `TEMPSUMMON_CORPSE_DESPAWN`. */
const SUMMON_TIMED = 1;
const SUMMON_UNTIL_CORPSE = 5;
/** `GO_STATE_ACTIVE` (open) and `GO_STATE_READY` (closed). */
const GO_OPEN = 0;
const GO_CLOSED = 1;
const DEFAULT_GREETING = 'Greetings, $N.';

const num = (raw: string | null | undefined): number => {
  if (raw === null || raw === undefined) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
};
const text = (n: number): string => String(n);

function keyOf(row: RawRow, columns: readonly string[]): Row {
  return Object.fromEntries(columns.map((c) => [c, row[c] ?? '0']));
}

interface SceneOutput {
  rows: { table: string; row: Row }[];
}

export function compileScenes(input: CompileInput): CompiledScripts {
  const { questId, scenes, objectives, context } = input;
  const out: CompiledScripts = { inserts: {}, deletes: {}, updates: [], flags: [], warnings: [] };

  // --- Which tagged rows are this quest's to replace -------------------------------------------
  const protectedScenes = new Set<string>();
  for (const row of context.smartScripts) {
    if (!isOurs(row.comment, questId)) continue;
    if (num(row.source_type) > SOURCE.areatrigger || num(row.event_type) === EVENT.link) continue;
    if (row.comment!.includes(DATA_MARKER) && sceneFromComment(row.comment) === null) {
      const id = sceneIdOf(row.comment, questId);
      if (id) protectedScenes.add(id);
    }
  }
  for (const id of [...protectedScenes].sort()) {
    out.warnings.push(`Scene ${id} on this quest could not be read, so its rows are left as they are.`);
  }
  // Only scene rows: fight rows (`AQC q<quest> fight<entry>`) belong to the fight compiler.
  const ours = (comment: string | null | undefined): boolean => {
    const id = sceneIdOf(comment, questId);
    return id !== null && !protectedScenes.has(id);
  };

  // --- Deletes ----------------------------------------------------------------------------------
  const deleteKeys = new Map<string, Map<string, Row>>();
  const addDelete = (table: string, key: Row): void => {
    const byText = deleteKeys.get(table) ?? new Map<string, Row>();
    byText.set(JSON.stringify(key), key);
    deleteKeys.set(table, byText);
  };
  const ownSmart = context.smartScripts.filter((r) => ours(r.comment));
  for (const row of ownSmart) addDelete('smart_scripts', keyOf(row, SMART_KEY));
  for (const row of context.creatureText) if (ours(row.comment)) addDelete('creature_text', keyOf(row, TEXT_KEY));
  for (const row of context.conditions) if (ours(row.Comment)) addDelete('conditions', keyOf(row, CONDITION_KEY));
  for (const row of context.waypoints) if (ours(row.point_comment)) addDelete('waypoints', keyOf(row, WAYPOINT_KEY));

  const previousArea = new Map<string, number>();
  for (const row of ownSmart) {
    if (num(row.event_type) === EVENT.gossipSelect) {
      addDelete('gossip_menu_option', { MenuID: row.event_param1 ?? '0', OptionID: row.event_param2 ?? '0' });
    }
    if (num(row.source_type) === SOURCE.areatrigger && num(row.event_type) !== EVENT.link) {
      const scene = sceneFromComment(row.comment);
      if (scene?.owner.kind === 'areatrigger' && scene.owner.area) {
        addDelete('areatrigger', { entry: row.entryorguid ?? '0' });
        addDelete('areatrigger_scripts', { entry: row.entryorguid ?? '0' });
        previousArea.set(scene.id, num(row.entryorguid));
      }
    }
  }
  for (const [table, byText] of deleteKeys) {
    out.deletes[table] = [...byText.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, key]) => key);
  }
  const deleted = (table: string, key: Row): boolean => deleteKeys.get(table)?.has(JSON.stringify(key)) ?? false;

  // --- What other rows already hold ---------------------------------------------------------------
  const alloc = createAllocator({
    smartScripts: context.smartScripts.filter((r) => !ours(r.comment)),
    creatureText: context.creatureText.filter((r) => !ours(r.comment)),
  });
  const usedOptions = new Map<number, Set<number>>();
  for (const row of context.gossipOptions) {
    if (deleted('gossip_menu_option', { MenuID: row.MenuID ?? '0', OptionID: row.OptionID ?? '0' })) continue;
    const options = usedOptions.get(num(row.MenuID)) ?? new Set<number>();
    options.add(num(row.OptionID));
    usedOptions.set(num(row.MenuID), options);
  }
  const previousPath = new Map<string, number>();
  for (const row of context.waypoints) {
    if (!ours(row.point_comment)) continue;
    const id = sceneIdOf(row.point_comment, questId);
    if (!id) continue;
    const entry = num(row.entry);
    previousPath.set(id, Math.min(previousPath.get(id) ?? entry, entry));
  }
  const creatures = new Map(context.creatures.map((r) => [num(r.entry), r]));
  const gameobjects = new Map(context.gameobjects.map((r) => [num(r.entry), r]));
  const areaScripts = new Map<number, string>();
  for (const row of context.areatriggerScripts) {
    if (deleted('areatrigger_scripts', { entry: row.entry ?? '0' })) continue;
    areaScripts.set(num(row.entry), row.ScriptName ?? '');
  }

  const takeOption = (menu: number): number => {
    const options = usedOptions.get(menu) ?? new Set<number>();
    usedOptions.set(menu, options);
    let option = 0;
    while (options.has(option)) option += 1;
    options.add(option);
    return option;
  };

  // --- Global numbers: escort paths, new area triggers, new gossip menus -----------------------------
  const pathOf = new Map<string, number>();
  const takenPaths = new Set<number>(previousPath.values());
  let nextPath = context.waypointsMax;
  for (const scene of scenes) {
    if (!scene.steps.some((s) => s.kind === 'startEscort')) continue;
    const previous = previousPath.get(scene.id);
    if (previous !== undefined) {
      pathOf.set(scene.id, previous);
      continue;
    }
    do nextPath += 1;
    while (takenPaths.has(nextPath));
    takenPaths.add(nextPath);
    pathOf.set(scene.id, nextPath);
  }
  const takenAreas = new Set<number>(previousArea.values());
  let nextArea = context.areatriggerMax;
  const areaOf = (scene: QuestScene): number => {
    const previous = previousArea.get(scene.id);
    if (previous !== undefined) return previous;
    do nextArea += 1;
    while (takenAreas.has(nextArea));
    takenAreas.add(nextArea);
    return nextArea;
  };
  let nextMenu = context.gossipMenuMax;
  let nextText = context.npcTextMax;
  const menuOf = new Map<number, number>();

  const setupDone = new Set<string>();
  const insert = (table: string, row: Row): void => {
    (out.inserts[table] ??= []).push(row);
  };

  // --- One scene --------------------------------------------------------------------------------
  const compileOne = (scene: QuestScene): void => {
    const tag = sceneTag(questId, scene.id);
    const pending: SceneOutput['rows'] = [];
    const owner = scene.owner;
    let entryorguid: number;
    let source: number;
    if (owner.kind === 'creature') [entryorguid, source] = [owner.entry, SOURCE.creature];
    else if (owner.kind === 'gameobject') [entryorguid, source] = [owner.entry, SOURCE.gameobject];
    else [entryorguid, source] = [owner.area ? areaOf(scene) : owner.id, SOURCE.areatrigger];
    if (entryorguid <= 0) return;

    const hasPlayer = triggerHasPlayer(scene.trigger);
    const actions = scene.steps.flatMap((step) => stepActions(step));
    if (actions.length === 0) return;

    function stepActions(step: SceneStep): SmartAction[] {
      const describe = describeStep(step);
      const one = (type: number, params: number[], target: number, extra: Partial<SmartAction> = {}): SmartAction[] => [
        { type, params, target, targetParams: [], waitMs: step.waitMs, describe, ...extra },
      ];
      switch (step.kind) {
        case 'say': {
          const group = alloc.takeGroup(entryorguid);
          const type = step.style === 'yell' ? TEXT_TYPE.yell : step.style === 'emote' ? TEXT_TYPE.textEmote : TEXT_TYPE.say;
          pending.push({
            table: 'creature_text',
            row: {
              CreatureID: text(entryorguid), GroupID: text(group), ID: '0', Text: step.text, Type: text(type), Language: '0',
              Probability: '100', Emote: '0', Duration: '0', Sound: '0', BroadcastTextId: '0', TextRange: '0',
              comment: `${tag}: ${describe}`,
            },
          });
          return one(ACTION.talk, [group, 0, hasPlayer ? 1 : 0], hasPlayer ? TARGET.invoker : TARGET.self);
        }
        case 'emote':
          return one(ACTION.playEmote, [step.emote], TARGET.self);
        case 'credit':
          return one(ACTION.killedMonster, [objectives[step.objective - 1] ?? 0], step.group ? TARGET.invokerParty : TARGET.invoker);
        case 'eventCredit':
          return one(step.group ? ACTION.groupEventHappens : ACTION.areaExploredOrEventHappens, [questId], TARGET.invoker);
        case 'failQuest':
          return one(ACTION.failQuest, [questId], TARGET.invoker);
        case 'castOnPlayer':
          return one(ACTION.cast, [step.spellId], TARGET.invoker);
        case 'castOnSelf':
          return one(ACTION.cast, [step.spellId], TARGET.self);
        case 'giveItem':
          return one(ACTION.addItem, [step.item, step.count], TARGET.invoker);
        case 'takeItem':
          return one(ACTION.removeItem, [step.item, step.count], TARGET.invoker);
        case 'spawnNpc':
          return one(
            ACTION.summonCreature,
            [step.entry, step.despawnAfterS > 0 ? SUMMON_TIMED : SUMMON_UNTIL_CORPSE, step.despawnAfterS * 1000, step.attackPlayer ? 1 : 0],
            TARGET.position,
            { at: step.at },
          );
        case 'spawnObject':
          return one(ACTION.summonGo, [step.entry, step.despawnAfterS, 0, 0], TARGET.position, { at: step.at });
        case 'despawn':
          return step.entry === 0
            ? one(ACTION.forceDespawn, [0], TARGET.self)
            : one(ACTION.forceDespawn, [0], TARGET.closestCreature, { targetParams: [step.entry, Math.round(step.range)] });
        case 'moveTo':
          return one(ACTION.moveToPos, [0], TARGET.position, { at: step.at });
        case 'startEscort': {
          const path = pathOf.get(scene.id) ?? 0;
          step.points.forEach((p, i) =>
            pending.push({
              table: 'waypoints',
              row: {
                entry: text(path), pointid: text(i + 1), position_x: text(p.x), position_y: text(p.y), position_z: text(p.z),
                orientation: text(p.o), delay: '0', point_comment: `${tag}: point ${i + 1}`,
              },
            }),
          );
          return one(ACTION.escortStart, [step.run ? 1 : 0, path, 0, questId, 0, 0], TARGET.invoker);
        }
        case 'npcFlags': {
          const bits = (state: 'on' | 'off'): number =>
            (step.questGiver === state ? QUEST_GIVER_BIT : 0) | (step.gossip === state ? GOSSIP_BIT : 0);
          const rows: SmartAction[] = [];
          if (bits('on') !== 0) rows.push(...one(ACTION.addNpcFlag, [bits('on')], TARGET.self));
          if (bits('off') !== 0) rows.push(...one(ACTION.removeNpcFlag, [bits('off')], TARGET.self, { waitMs: rows.length > 0 ? 0 : step.waitMs }));
          return rows;
        }
        case 'faction':
          return one(ACTION.setFaction, [step.faction], TARGET.self);
        case 'objectState': {
          const state = step.state === 'open' ? GO_OPEN : GO_CLOSED;
          return step.entry === 0
            ? one(ACTION.goSetGoState, [state], TARGET.self)
            : one(ACTION.goSetGoState, [state], TARGET.closestGameobject, { targetParams: [step.entry, Math.round(step.range)] });
        }
        case 'signal':
          return one(
            ACTION.setData,
            [step.signal, 1],
            step.targetKind === 'creature' ? TARGET.creatureRange : TARGET.gameobjectRange,
            { targetParams: [step.entry, 0, Math.round(step.range)] },
          );
        case 'closeGossip':
          return one(ACTION.closeGossip, [], TARGET.invoker);
      }
    }

    // The trigger's event, including the gossip option it hangs off.
    let event: number[];
    let gossip: { menu: number; option: number } | null = null;
    switch (scene.trigger.kind) {
      case 'questAccepted':
        event = [EVENT.acceptedQuest, questId];
        break;
      case 'questHandedIn':
        event = [EVENT.rewardQuest, questId];
        break;
      case 'spellHit':
        event = [EVENT.spellHit, scene.trigger.spellId];
        break;
      case 'dies':
        event = [EVENT.death];
        break;
      case 'talkedTo':
        event = [EVENT.gossipHello, 0];
        break;
      case 'gossipOption': {
        const creature = creatures.get(entryorguid);
        let menu = num(creature?.gossip_menu_id);
        if (menu === 0) {
          const existing = menuOf.get(entryorguid);
          if (existing !== undefined) menu = existing;
          else {
            nextMenu += 1;
            nextText += 1;
            menu = nextMenu;
            menuOf.set(entryorguid, menu);
            pending.push({ table: 'npc_text', row: { ID: text(nextText), text0_0: scene.trigger.greeting || DEFAULT_GREETING, Probability0: '1' } });
            pending.push({ table: 'gossip_menu', row: { MenuID: text(menu), TextID: text(nextText) } });
            out.updates.push({
              table: 'creature_template', key: { entry: text(entryorguid) }, set: { gossip_menu_id: text(menu) }, onlyIf: { gossip_menu_id: '0' },
            });
          }
        }
        const option = takeOption(menu);
        gossip = { menu, option };
        pending.push({
          table: 'gossip_menu_option',
          row: { MenuID: text(menu), OptionID: text(option), OptionIcon: '0', OptionText: scene.trigger.text, OptionType: '1', OptionNpcFlag: '1' },
        });
        if (!setupDone.has(`gossip:${entryorguid}`) && (num(creature?.npcflag) & GOSSIP_BIT) === 0) {
          setupDone.add(`gossip:${entryorguid}`);
          out.flags.push({ table: 'creature_template', column: 'npcflag', bit: GOSSIP_BIT, key: { entry: text(entryorguid) } });
        }
        event = [EVENT.gossipSelect, menu, option];
        break;
      }
      case 'playerNear':
        event = [EVENT.oocLos, 2, Math.round(scene.trigger.range), 10000, 10000, 1];
        break;
      case 'enterArea':
        event = [EVENT.areatrigger, entryorguid];
        break;
      case 'signal':
        event = [EVENT.dataSet, scene.trigger.signal, 1];
        break;
      case 'waypointReached':
        event = [EVENT.escortReached, scene.trigger.point, pathOf.get(scene.trigger.escortSceneId) ?? 0];
        break;
      case 'summoned':
        event = [EVENT.justSummoned];
        break;
    }

    const [eventType, ...eventParams] = event;
    const emitted = emitTrigger({
      alloc, entryorguid, source, eventType: eventType!, eventParams, actions,
      header: triggerComment(questId, scene), tag, shape: source === SOURCE.areatrigger ? 'link' : 'list',
    });
    if (emitted === null) {
      out.warnings.push(`No free timed action list id for ${owner.kind} ${entryorguid}.`);
      return;
    }
    const { triggerId } = emitted;
    for (const row of emitted.rows) pending.push({ table: 'smart_scripts', row });

    // Gates: on the trigger row, and again on the gossip option so it only shows when it would work.
    const conditionRow = (sourceType: number, group: number, entry: number, sourceId: number, gate: SceneGate): Row => {
      const values = gateValues(gate, questId);
      return {
        SourceTypeOrReferenceId: text(sourceType), SourceGroup: text(group), SourceEntry: text(entry), SourceId: text(sourceId),
        ElseGroup: '0', ConditionTypeOrReference: text(values[0]), ConditionTarget: '0',
        ConditionValue1: text(values[1]), ConditionValue2: text(values[2]), ConditionValue3: '0',
        NegativeCondition: 'negate' in gate && gate.negate ? '1' : '0', ErrorType: '0', ErrorTextId: '0', ScriptName: '',
        Comment: `${tag}: only when ${describeGate(gate)}`,
      };
    };
    for (const gate of scene.gates) {
      pending.push({ table: 'conditions', row: conditionRow(CONDITION_SOURCE_SMART_EVENT, triggerId + 1, entryorguid, source, gate) });
    }
    if (gossip) {
      for (const gate of scene.gates) {
        pending.push({ table: 'conditions', row: conditionRow(CONDITION_SOURCE_GOSSIP_OPTION, gossip.menu, gossip.option, 0, gate) });
      }
    }

    // The owner has to be set up for SmartAI, or none of this runs.
    const setupKey = `${owner.kind}:${entryorguid}`;
    if (!setupDone.has(setupKey)) {
      setupDone.add(setupKey);
      if (owner.kind === 'creature' && creatures.get(entryorguid)?.AIName !== 'SmartAI') {
        out.updates.push({ table: 'creature_template', key: { entry: text(entryorguid) }, set: { AIName: 'SmartAI' }, onlyIf: { AIName: '' } });
      } else if (owner.kind === 'gameobject' && gameobjects.get(entryorguid)?.AIName !== 'SmartGameObjectAI') {
        out.updates.push({ table: 'gameobject_template', key: { entry: text(entryorguid) }, set: { AIName: 'SmartGameObjectAI' }, onlyIf: { AIName: '' } });
      } else if (owner.kind === 'areatrigger') {
        if (owner.area) {
          pending.push({
            table: 'areatrigger',
            row: {
              entry: text(entryorguid), map: text(owner.area.map), x: text(owner.area.x), y: text(owner.area.y), z: text(owner.area.z),
              radius: text(owner.area.radius), length: '0', width: '0', height: '0', orientation: '0',
            },
          });
        }
        const existing = areaScripts.get(entryorguid);
        if (existing === undefined) pending.push({ table: 'areatrigger_scripts', row: { entry: text(entryorguid), ScriptName: 'SmartTrigger' } });
        else if (existing !== 'SmartTrigger') {
          out.warnings.push(`Area trigger ${entryorguid} already runs the script ${existing}, so its SmartAI scenes will not run.`);
        }
      }
    }

    for (const { table, row } of pending) insert(table, row);
  };

  for (const scene of scenes) compileOne(scene);
  return out;
}

/** `[condition type, value1, value2]` for a gate; quest 0 means the quest being exported. */
function gateValues(gate: SceneGate, questId: number): [number, number, number] {
  switch (gate.kind) {
    case 'quest': {
      const quest = gate.questId === 0 ? questId : gate.questId;
      const type = {
        inLog: CONDITION.questTaken,
        objectivesDone: CONDITION.questComplete,
        handedIn: CONDITION.questRewarded,
        neverTaken: CONDITION.questNone,
      }[gate.state];
      return [type, quest, 0];
    }
    case 'item':
      return [CONDITION.item, gate.item, gate.count];
    case 'team':
      return [CONDITION.team, TEAM[gate.team], 0];
  }
}
