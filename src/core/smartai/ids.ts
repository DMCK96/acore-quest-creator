import type { ScriptRow } from '../links/model';

/**
 * SmartAI's numeric vocabulary, lifted from AzerothCore's fork headers so a component reader never
 * hard-codes a magic number inline. Values come from `SmartScriptMgr.h`'s `SMART_SCRIPT_TYPE_*`
 * (source types), `SMART_EVENT_*` and `SMART_ACTION_*` enums, and from `ConditionMgr.h`'s
 * `CONDITION_SOURCE_TYPE_SMART_EVENT`. Every string below (`describeEvent`, `actionName`,
 * `sourceName`) is this project's own wording, not copied from any editor.
 */

export const SOURCE = {
  creature: 0,
  gameobject: 1,
  areatrigger: 2,
  event: 3,
  gossip: 4,
  quest: 5,
  spell: 6,
  transport: 7,
  instance: 8,
  timedList: 9,
} as const;

export const EVENT = {
  updateOoc: 1,
  kill: 5,
  death: 6,
  acceptedQuest: 19,
  rewardQuest: 20,
  receiveEmote: 22,
  areatrigger: 46,
  questAccepted: 47,
  questObjCompletion: 48,
  questCompletion: 49,
  questRewarded: 50,
  questFail: 51,
  link: 61,
  gossipSelect: 62,
  gossipHello: 64,
  gameEventStart: 68,
  goStateChanged: 70,
  spellClick: 73,
} as const;

export const ACTION = {
  failQuest: 6,
  offerQuest: 7,
  areaExploredOrEventHappens: 15,
  groupEventHappens: 26,
  escortStart: 53,
  escortStop: 55,
  callTimedList: 80,
  callRandomTimedList: 87,
  callRandomRangeTimedList: 88,
} as const;

export const CONDITION_SOURCE_SMART_EVENT = 22;

const SOURCE_NAMES: Record<number, string> = {
  [SOURCE.creature]: 'creature',
  [SOURCE.gameobject]: 'game object',
  [SOURCE.areatrigger]: 'area trigger',
  [SOURCE.event]: 'event',
  [SOURCE.gossip]: 'gossip',
  [SOURCE.quest]: 'quest',
  [SOURCE.spell]: 'spell',
  [SOURCE.transport]: 'transport',
  [SOURCE.instance]: 'instance',
  [SOURCE.timedList]: 'timed action list',
};

const ACTION_NAMES: Record<number, string> = {
  [ACTION.failQuest]: 'fail quest',
  [ACTION.offerQuest]: 'offer quest',
  [ACTION.areaExploredOrEventHappens]: 'complete an explore objective',
  [ACTION.groupEventHappens]: 'complete a group objective',
  [ACTION.escortStart]: 'start an escort',
  [ACTION.escortStop]: 'stop an escort',
  [ACTION.callTimedList]: 'run a timed action list',
  [ACTION.callRandomTimedList]: 'run a random timed action list',
  [ACTION.callRandomRangeTimedList]: 'run a random timed action list',
};

/** Plain-English name for a `source_type`, so provenance UI never shows a bare number. */
export function sourceName(sourceType: number): string {
  return SOURCE_NAMES[sourceType] ?? `source type ${sourceType}`;
}

/** Plain-English name for an `action_type`, independent of its parameters. */
export function actionName(actionType: number): string {
  return ACTION_NAMES[actionType] ?? `SmartAI action ${actionType}`;
}

/** Plain-English description of what fires a script row's event, for provenance and tooltips. */
export function describeEvent(row: ScriptRow): string {
  const p1 = row.eventParams[0];
  const p2 = row.eventParams[1];
  switch (row.eventType) {
    case EVENT.gossipSelect:
      return `when the player chooses gossip option ${p2} of menu ${p1}`;
    case EVENT.gossipHello:
      return 'when the player talks to it';
    case EVENT.areatrigger:
      return p1 === 0 ? 'when the player enters the area trigger' : `when the player enters area trigger ${p1}`;
    case EVENT.acceptedQuest:
      return `when quest ${p1} is accepted`;
    case EVENT.rewardQuest:
      return `when quest ${p1} is turned in`;
    case EVENT.questAccepted:
      return 'when the quest is accepted';
    case EVENT.questObjCompletion:
      return 'when a quest objective is completed';
    case EVENT.questCompletion:
      return 'when the quest is completed';
    case EVENT.questRewarded:
      return 'when the quest is turned in';
    case EVENT.questFail:
      return 'when the quest fails';
    case EVENT.death:
      return 'when it dies';
    case EVENT.kill:
      return 'when it kills something';
    case EVENT.updateOoc:
      return 'on a timer while out of combat';
    case EVENT.receiveEmote:
      return `when the player uses emote ${p1}`;
    case EVENT.gameEventStart:
      return `when game event ${p1} starts`;
    case EVENT.goStateChanged:
      return `when its state changes to ${p1}`;
    case EVENT.spellClick:
      return 'when the player clicks it';
    case EVENT.link:
      return 'as part of a linked action';
    default:
      return `on SmartAI event ${row.eventType}`;
  }
}
