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
  updateIc: 0,
  updateOoc: 1,
  kill: 5,
  death: 6,
  spellHit: 8,
  oocLos: 10,
  acceptedQuest: 19,
  rewardQuest: 20,
  receiveEmote: 22,
  dataSet: 38,
  escortReached: 40,
  areatrigger: 46,
  questAccepted: 47,
  questObjCompletion: 48,
  questCompletion: 49,
  questRewarded: 50,
  questFail: 51,
  justSummoned: 54,
  link: 61,
  gossipSelect: 62,
  gossipHello: 64,
  gameEventStart: 68,
  goStateChanged: 70,
  spellClick: 73,
} as const;

export const ACTION = {
  talk: 1,
  setFaction: 2,
  playEmote: 5,
  failQuest: 6,
  offerQuest: 7,
  cast: 11,
  summonCreature: 12,
  areaExploredOrEventHappens: 15,
  groupEventHappens: 26,
  killedMonster: 33,
  forceDespawn: 41,
  setData: 45,
  summonGo: 50,
  escortStart: 53,
  escortStop: 55,
  addItem: 56,
  removeItem: 57,
  moveToPos: 69,
  closeGossip: 72,
  callTimedList: 80,
  addNpcFlag: 82,
  removeNpcFlag: 83,
  callRandomTimedList: 87,
  callRandomRangeTimedList: 88,
  goSetGoState: 118,
} as const;

/** `SMART_TARGET_*`: who an action applies to. */
export const TARGET = {
  self: 1,
  invoker: 7,
  position: 8,
  creatureRange: 9,
  gameobjectRange: 13,
  invokerParty: 16,
  closestCreature: 19,
  closestGameobject: 20,
} as const;

/** `CONDITION_*` from `ConditionMgr.h`: what a condition row checks. */
export const CONDITION = {
  item: 2,
  team: 6,
  questRewarded: 8,
  questTaken: 9,
  questNone: 14,
  questComplete: 28,
} as const;

/** `CONDITION_SOURCE_TYPE_GOSSIP_MENU_OPTION`: conditions that show or hide one gossip option. */
export const CONDITION_SOURCE_GOSSIP_OPTION = 15;

/** `ChatMsg` values `creature_text.Type` takes for what an NPC says. */
export const TEXT_TYPE = { say: 12, yell: 14, textEmote: 16 } as const;

/** `Team` ids `CONDITION_TEAM` compares against. */
export const TEAM = { alliance: 469, horde: 67 } as const;

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

/** What an action does, in the words the Scripts module lists other people's scripts with. */
const STEP_NAMES: Record<number, string> = {
  [ACTION.talk]: 'say a line',
  [ACTION.playEmote]: 'play an emote',
  [ACTION.cast]: 'cast a spell',
  [ACTION.summonCreature]: 'spawn an NPC',
  [ACTION.areaExploredOrEventHappens]: 'complete an event objective',
  [ACTION.groupEventHappens]: 'complete an event objective for the group',
  [ACTION.killedMonster]: 'give kill credit',
  [ACTION.forceDespawn]: 'despawn',
  [ACTION.setData]: 'tell another script',
  [ACTION.summonGo]: 'spawn an object',
  [ACTION.escortStart]: 'start an escort',
  [ACTION.addItem]: 'give an item',
  [ACTION.moveToPos]: 'move',
  [ACTION.callTimedList]: 'run a sequence',
  [ACTION.addNpcFlag]: 'change NPC flags',
  [ACTION.removeNpcFlag]: 'change NPC flags',
  [ACTION.goSetGoState]: 'change object state',
  [ACTION.setFaction]: 'change faction',
  [ACTION.failQuest]: 'fail the quest',
  [ACTION.offerQuest]: 'offer a quest',
  [ACTION.removeItem]: 'take an item',
  [ACTION.closeGossip]: 'close the talk window',
  3: 'change its model',
  4: 'play a sound',
  8: 'change how it reacts',
  9: 'use an object',
  10: 'play a random emote',
  17: 'keep playing an emote',
  18: 'change unit flags',
  19: 'change unit flags',
  20: 'switch auto attack',
  21: 'change combat movement',
  22: 'change script phase',
  23: 'change script phase',
  24: 'stop fighting',
  25: 'flee for help',
  28: 'remove an aura',
  29: 'follow someone',
  37: 'die',
  39: 'call for help',
  40: 'sheathe or draw weapons',
  43: 'mount or dismount',
  44: 'change phase',
  47: 'show or hide',
  48: 'stay active when no one is near',
  49: 'attack',
  51: 'kill a unit',
  52: 'send on a flight',
  54: 'pause the escort',
  55: 'stop the escort',
  59: 'switch between running and walking',
  62: 'teleport',
  63: 'set a counter',
  64: 'remember a target',
  65: 'resume the escort',
  66: 'turn to face',
  67: 'start a timer',
  70: 'respawn',
  71: 'change equipment',
  73: 'set off a timer',
  75: 'add an aura',
  81: 'set NPC flags',
  84: 'say a line',
  85: 'cast a spell',
  86: 'cast a spell',
  87: 'run a random sequence',
  88: 'run a random sequence',
  89: 'wander',
  90: 'change stance',
  91: 'change stance',
  97: 'jump',
  98: 'show a talk window',
  99: 'change object loot state',
  101: 'set its home',
  103: 'root in place',
  104: 'change object flags',
  105: 'change object flags',
  106: 'change object flags',
  107: 'spawn a group of NPCs',
  115: 'play a random sound',
  134: 'cast a spell',
};

/** A script action as one step of a sentence, for scripts the tool did not write. */
export function stepName(actionType: number): string {
  return STEP_NAMES[actionType] ?? `SmartAI action ${actionType}`;
}

/** Events that only fire around a fight; the combat wizard, not quest scripting, will own them. */
export const COMBAT_EVENTS: ReadonlySet<number> = new Set([0, 2, 3, 4, 5, 7, 9, 12, 13, 14, 32, 33]);

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
    case EVENT.updateIc:
      return 'on a timer in combat';
    case 2:
      return 'at a health level';
    case 4:
      return 'when it enters combat';
    case EVENT.spellHit:
      return 'when a spell hits it';
    case EVENT.oocLos:
      return 'when a player comes near';
    case EVENT.dataSet:
      return 'when told by another script';
    case EVENT.escortReached:
      return 'when an escort reaches a point';
    case EVENT.justSummoned:
      return 'when it is spawned';
    case 7:
      return 'when it stops fighting';
    case 11:
      return 'when it respawns';
    case 25:
      return 'when it resets';
    case 34:
      return 'when it arrives at a point';
    case 52:
      return 'when it finishes a line';
    case 59:
      return 'when its own timer goes off';
    case 60:
      return 'on a timer';
    case 63:
      return 'when it first appears';
    case 72:
      return 'when another script signals it is done';
    case 77:
      return 'when a counter reaches a value';
    case 101:
      return 'when players are near';
    case 108:
      return 'when it reaches a waypoint';
    case 109:
      return 'when it finishes its path';
    default:
      return `on SmartAI event ${row.eventType}`;
  }
}
