import type { RawRow } from '../../db/types';
import { ACTION, EVENT, SOURCE, describeEvent } from '../../smartai/ids';
import {
  instanceId, scriptRowKey, type ComponentInstance, type Endpoint, type LinkContext, type RowRef, type ScriptRow,
} from '../model';
import { endpointName } from '../describe';
import type { ComponentDef, RecogniseInput } from '../component';

/**
 * Quest starts that live outside the quest's own tables: a SmartAI script that offers the quest, and
 * the inferred "the server's own code does it" start for an imported quest nothing in the DB explains.
 *
 * Neither is editable here. A SmartAI offer is only one row of a script whose other rows (its event,
 * the links leading to it, the conditions on it) decide when it fires, so editing it safely needs the
 * trigger catalog; a backend start has no rows at all and is never written (global constraints).
 */

export const SMARTAI_READ_ONLY = 'SmartAI triggers become editable with the trigger catalog.';
export const ITEM_READ_ONLY = 'Items that begin a quest are edited on the item, which this version does not do yet.';
export const BACKEND_READ_ONLY = "No start was found in the database. The server's own code probably starts this quest.";

const numberOf = (raw: string | null | undefined): number => {
  if (raw === null || raw === undefined) return 0;
  const n = Number(raw);
  return Number.isInteger(n) ? n : 0;
};

const scriptClaim = (row: ScriptRow): RowRef => ({ table: 'smart_scripts', key: scriptRowKey(row) });

/**
 * A linked row (event 61) only fires when the row that links to it fires, so what actually triggers an
 * offer is the head of its link chain. The visited set stops a malformed chain that loops back on
 * itself; a link of 0 means "no link", so it never makes a row a parent.
 */
function walkChain(start: ScriptRow, scripts: readonly ScriptRow[]): { trigger: ScriptRow; rows: ScriptRow[] } {
  const visited = new Set<string>([scriptRowKey(start)]);
  const rows = [start];
  let current = start;
  while (current.eventType === EVENT.link) {
    const parent = scripts.find((r) => r.entryorguid === current.entryorguid && r.sourceType === current.sourceType
      && r.link !== 0 && r.link === current.id);
    if (!parent || visited.has(scriptRowKey(parent))) break;
    visited.add(scriptRowKey(parent));
    rows.push(parent);
    current = parent;
  }
  return { trigger: current, rows };
}

function sourceEndpoint(row: ScriptRow): Endpoint {
  const e = row.entryorguid;
  switch (row.sourceType) {
    case SOURCE.creature:
      return e > 0 ? { kind: 'creature', entry: e } : { kind: 'creatureSpawn', guid: -e };
    case SOURCE.gameobject:
      return e > 0 ? { kind: 'gameobject', entry: e } : { kind: 'gameobjectSpawn', guid: -e };
    case SOURCE.areatrigger:
      return { kind: 'areatrigger', id: e };
    case SOURCE.quest:
      return { kind: 'quest', questId: e };
    default:
      return { kind: 'script', sourceType: row.sourceType, entryorguid: e };
  }
}

/**
 * Spec §12.1: a script row in the DB is not a script the server runs. Creatures and objects only run
 * SmartAI when their template names the SmartAI class, and an area trigger only when it is bound to
 * `SmartTrigger`. GUID-scoped scripts inherit their template's AI, which the context does not read, so
 * they are left unchecked rather than guessed at.
 */
function inactiveReasonFor(trigger: ScriptRow, context: LinkContext): string | undefined {
  const entry = trigger.entryorguid;
  const aiName = (sourceType: 0 | 1): string =>
    context.aiNames.find((a) => a.sourceType === sourceType && a.entry === entry)?.aiName ?? '';
  if (trigger.sourceType === SOURCE.creature && entry > 0) {
    const name = aiName(0);
    return name === 'SmartAI' ? undefined : `NPC ${entry} does not use SmartAI (its AIName is "${name}"), so this script never runs.`;
  }
  if (trigger.sourceType === SOURCE.gameobject && entry > 0) {
    const name = aiName(1);
    return name === 'SmartGameObjectAI' ? undefined : `Object ${entry} does not use SmartAI (its AIName is "${name}"), so this script never runs.`;
  }
  if (trigger.sourceType === SOURCE.areatrigger) {
    const bound = context.areatriggerScripts.some((a) => a.entry === entry && a.scriptName === 'SmartTrigger');
    return bound ? undefined : `Area trigger ${entry} is not set to run SmartAI (it needs an areatrigger_scripts row with ScriptName "SmartTrigger"), so this script never runs.`;
  }
  return undefined;
}

const CONDITION_KEY_COLUMNS = [
  'SourceGroup', 'SourceEntry', 'SourceId', 'ElseGroup', 'ConditionTypeOrReference', 'ConditionTarget',
  'ConditionValue1', 'ConditionValue2', 'ConditionValue3',
] as const;

function conditionClaim(row: RawRow): RowRef {
  const parts = CONDITION_KEY_COLUMNS.map((c) => `${c}=${row[c] ?? '0'}`);
  return { table: 'conditions', key: ['SourceTypeOrReferenceId=22', ...parts].join(',') };
}

/** SmartAI event conditions are keyed by the event's row id plus one, so id 0 is SourceGroup 1. */
function eventConditionClaims(trigger: ScriptRow, context: LinkContext): RowRef[] {
  return context.eventConditions
    .filter((row) => numberOf(row.SourceEntry) === trigger.entryorguid
      && numberOf(row.SourceId) === trigger.sourceType
      && numberOf(row.SourceGroup) === trigger.id + 1)
    .map(conditionClaim);
}

function recogniseSmartAi(input: RecogniseInput): ComponentInstance[] {
  const { context } = input;
  const instances: ComponentInstance[] = [];
  for (const row of context.questRows) {
    if (row.actionType !== ACTION.offerQuest) continue;
    const questId = row.actionParams[0];
    if (!input.facts.has(questId)) continue;

    const walk = walkChain(row, context.scripts);
    let trigger = walk.trigger;
    const rows = [...walk.rows];
    let source: Endpoint = sourceEndpoint(trigger);

    // A timed action list has no trigger of its own; whoever calls it decides when the offer happens.
    if (trigger.sourceType === SOURCE.timedList) {
      const listEntry = trigger.entryorguid;
      const caller = context.scripts.find((r) => r.actionType === ACTION.callTimedList && r.actionParams[0] === listEntry);
      if (caller) {
        const callerWalk = walkChain(caller, context.scripts);
        rows.push(...callerWalk.rows);
        trigger = callerWalk.trigger;
        source = sourceEndpoint(trigger);
      }
    }

    const questEvent = trigger.eventType === EVENT.acceptedQuest || trigger.eventType === EVENT.rewardQuest;
    const from: Endpoint = questEvent && trigger.eventParams[0] > 0 ? { kind: 'quest', questId: trigger.eventParams[0] } : source;
    const claims = [...rows.map(scriptClaim), ...eventConditionClaims(trigger, context)];
    const inactiveReason = inactiveReasonFor(trigger, context);
    instances.push({
      id: instanceId('start.smartai', claims),
      component: 'start.smartai',
      owner: questId,
      from,
      to: { kind: 'quest', questId },
      params: { trigger: describeEvent(trigger), source: endpointName(source, () => undefined), directAdd: row.actionParams[1] },
      claims,
      editable: false,
      readOnlyReason: SMARTAI_READ_ONLY,
      ...(inactiveReason === undefined ? {} : { inactiveReason }),
    });
  }
  return instances;
}

const startSmartAi: ComponentDef = {
  id: 'start.smartai',
  label: 'Offered by a SmartAI script',
  help: 'Offered by a SmartAI script',
  hook: 'start',
  action: 'offerQuest',
  mechanism: 'smartai',
  params: [
    { name: 'trigger', label: 'Trigger', type: { kind: 'string' } },
    { name: 'source', label: 'Script', type: { kind: 'string' } },
    { name: 'directAdd', label: 'Add straight to the log', type: { kind: 'int' } },
  ],
  requires: [{
    table: 'smart_scripts',
    columns: ['entryorguid', 'source_type', 'id', 'link', 'event_type', 'action_type', 'action_param1'],
  }],
  writable: false,
  recognise: recogniseSmartAi,
  describe(instance, names): string {
    const trigger = instance.params.trigger as string;
    if (instance.from.kind === 'quest') return `Offered by a script ${trigger}`;
    return `Offered by a script on ${endpointName(instance.from, names)} ${trigger}`;
  },
};

/**
 * The backend start is never recognised from rows; `recogniseLinks` infers it once every other
 * component has run, because only then is it known that nothing in the DB starts the quest.
 */
const startBackend: ComponentDef = {
  id: 'start.backend',
  label: 'Started by backend',
  help: 'Started by backend',
  hook: 'start',
  action: 'offerQuest',
  mechanism: 'backend',
  params: [],
  requires: [],
  writable: false,
  recognise: () => [],
  describe: () => 'Started by backend',
};

export const SMARTAI_COMPONENTS = { startSmartAi, startBackend } as const;
