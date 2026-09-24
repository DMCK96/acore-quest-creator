import type { QuestScene, SceneGate, SceneTrigger, StepBody } from './model';

const QUEST_STATES = {
  inLog: 'is in the log',
  objectivesDone: 'has all objectives done',
  handedIn: 'was handed in',
  neverTaken: 'was never taken',
} as const;

/** A gate as the "only when …" clause of a sentence. */
export function describeGate(gate: SceneGate): string {
  switch (gate.kind) {
    case 'quest': {
      const quest = gate.questId === 0 ? 'this quest' : `quest ${gate.questId}`;
      return `${gate.negate ? 'not: ' : ''}${quest} ${QUEST_STATES[gate.state]}`;
    }
    case 'item':
      return `${gate.negate ? 'not: ' : ''}the player has ${gate.count} × item ${gate.item}`;
    case 'team':
      return `the player is ${gate.team === 'alliance' ? 'Alliance' : 'Horde'}`;
  }
}

/** A scene's trigger in the words the editor and the row comments use. */
export function describeTrigger(trigger: SceneTrigger): string {
  switch (trigger.kind) {
    case 'questAccepted':
      return 'When the quest is accepted';
    case 'questHandedIn':
      return 'When the quest is handed in';
    case 'spellHit':
      return trigger.spellId === 0 ? 'When any spell or item is used on it' : `When spell ${trigger.spellId} is used on it`;
    case 'dies':
      return 'When it dies';
    case 'talkedTo':
      return 'When a player talks to it or uses it';
    case 'gossipOption':
      return `When a player picks "${trigger.text}"`;
    case 'playerNear':
      return `When a player comes within ${trigger.range} yards`;
    case 'enterArea':
      return 'When a player enters the area';
    case 'signal':
      return `When told signal ${trigger.signal}`;
    case 'waypointReached':
      return `When the escort reaches point ${trigger.point}`;
    case 'summoned':
      return 'When it is spawned by a scene';
  }
}

/** One step in lower case, so steps read as a sentence after the trigger. */
export function describeStep(step: StepBody): string {
  switch (step.kind) {
    case 'say':
      return `${step.style} "${step.text}"`;
    case 'emote':
      return `play emote ${step.emote}`;
    case 'credit':
      return `give the ${step.group ? 'group' : 'player'} credit for objective ${step.objective}`;
    case 'eventCredit':
      return `complete the quest's event objective${step.group ? ' for the group' : ''}`;
    case 'failQuest':
      return 'fail the quest';
    case 'castOnPlayer':
      return `cast spell ${step.spellId} on the player`;
    case 'castOnSelf':
      return `cast spell ${step.spellId} on itself`;
    case 'giveItem':
      return `give ${step.count} × item ${step.item}`;
    case 'takeItem':
      return `take ${step.count} × item ${step.item}`;
    case 'spawnNpc':
      return `spawn NPC ${step.entry}`;
    case 'spawnObject':
      return `spawn object ${step.entry}`;
    case 'despawn':
      return step.entry === 0 ? 'despawn itself' : `despawn the nearest NPC ${step.entry}`;
    case 'moveTo':
      return 'move to a point';
    case 'startEscort':
      return `start an escort of ${step.points.length} points`;
    case 'npcFlags':
      return 'change quest-giver and gossip';
    case 'faction':
      return step.faction === 0 ? 'restore its faction' : `change faction to ${step.faction}`;
    case 'objectState':
      return step.entry === 0 ? `${step.state === 'open' ? 'open' : 'close'} itself` : `${step.state === 'open' ? 'open' : 'close'} object ${step.entry}`;
    case 'signal':
      return `tell ${step.targetKind === 'creature' ? 'NPC' : 'object'} ${step.entry} signal ${step.signal}`;
    case 'closeGossip':
      return 'close the gossip window';
  }
}

/** The whole scene as one line: "When …: step, then step". */
export function describeScene(scene: QuestScene): string {
  const steps = scene.steps.length === 0 ? 'nothing yet' : scene.steps.map((s) => describeStep(s)).join(', then ');
  return `${describeTrigger(scene.trigger)}: ${steps}`;
}
