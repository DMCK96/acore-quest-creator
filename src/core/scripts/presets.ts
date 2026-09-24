import type { QuestScene, SceneOwner } from './model';

/**
 * Starting points for the scenes quests use most, taken from the research into AzerothCore's own
 * quest scripts. Each is prefilled from the quest so an author only fills in what differs.
 */

export type PresetId =
  | 'useItemCredit'
  | 'killCredit'
  | 'gossipCredit'
  | 'acceptSay'
  | 'handInSay'
  | 'handInSpawn'
  | 'escort'
  | 'areaCredit'
  | 'blank';

export interface QuestFacts {
  questId: number;
  starter: SceneOwner | null;
  ender: SceneOwner | null;
  /** The creature of the quest's first NPC objective; 0 when it has none. */
  firstNpcObjective: number;
}

export const PRESETS: readonly { id: PresetId; label: string; help: string }[] = [
  { id: 'useItemCredit', label: 'Use an item on a target, then give credit', help: 'A player uses a quest item or spell on an NPC, which counts for the objective and then disappears.' },
  { id: 'killCredit', label: 'Kill a target, then give credit', help: 'Killing an NPC counts for an objective, for example when the kill credit goes to a different NPC.' },
  { id: 'gossipCredit', label: 'Talk option gives credit', help: 'The NPC gets a new talk option that completes the quest while it is in the log.' },
  { id: 'acceptSay', label: 'NPC speaks when the quest is accepted', help: 'The quest giver says a line as the player takes the quest.' },
  { id: 'handInSay', label: 'NPC speaks when the quest is handed in', help: 'The NPC who takes the quest back says a line as the player hands it in.' },
  { id: 'handInSpawn', label: 'Something appears on hand-in', help: 'Handing the quest in spawns an NPC for a while, such as a reward or the next step of the story.' },
  { id: 'escort', label: 'Escort an NPC', help: 'Accepting the quest makes the NPC walk a path; the quest completes when it arrives and fails if it dies.' },
  { id: 'areaCredit', label: 'Enter an area for credit', help: 'Walking into an area completes the quest while it is in the log.' },
  { id: 'blank', label: 'Blank scene', help: 'Start from nothing and choose every part yourself.' },
];

const NOBODY: SceneOwner = { kind: 'creature', entry: 0 };
const ORIGIN = { x: 0, y: 0, z: 0, o: 0 };
const IN_LOG = { kind: 'quest', questId: 0, state: 'inLog', negate: false } as const;

export function presetScene(id: PresetId, facts: QuestFacts, sceneId: string): QuestScene {
  const name = PRESETS.find((p) => p.id === id)!.label;
  const objective: SceneOwner = { kind: 'creature', entry: facts.firstNpcObjective };
  const starter = facts.starter ?? NOBODY;
  const ender = facts.ender ?? NOBODY;
  const base = { id: sceneId, name };
  switch (id) {
    case 'useItemCredit':
      return {
        ...base, owner: objective, trigger: { kind: 'spellHit', spellId: 0 }, gates: [IN_LOG],
        steps: [
          { kind: 'credit', objective: 1, group: false, waitMs: 0 },
          { kind: 'despawn', entry: 0, range: 0, waitMs: 1000 },
        ],
      };
    case 'killCredit':
      return { ...base, owner: objective, trigger: { kind: 'dies' }, gates: [IN_LOG], steps: [{ kind: 'credit', objective: 1, group: false, waitMs: 0 }] };
    case 'gossipCredit':
      return {
        ...base, owner: starter, trigger: { kind: 'gossipOption', text: "I'm ready.", greeting: '' }, gates: [IN_LOG],
        steps: [{ kind: 'eventCredit', group: false, waitMs: 0 }, { kind: 'closeGossip', waitMs: 0 }],
      };
    case 'acceptSay':
      return { ...base, owner: starter, trigger: { kind: 'questAccepted' }, gates: [], steps: [{ kind: 'say', text: 'Good luck, $N.', style: 'say', waitMs: 0 }] };
    case 'handInSay':
      return { ...base, owner: ender, trigger: { kind: 'questHandedIn' }, gates: [], steps: [{ kind: 'say', text: 'Well done, $N.', style: 'say', waitMs: 0 }] };
    case 'handInSpawn':
      return {
        ...base, owner: ender, trigger: { kind: 'questHandedIn' }, gates: [],
        steps: [{ kind: 'spawnNpc', entry: 0, at: ORIGIN, despawnAfterS: 60, attackPlayer: false, waitMs: 0 }],
      };
    case 'escort':
      return {
        ...base, owner: starter, trigger: { kind: 'questAccepted' }, gates: [],
        steps: [
          { kind: 'npcFlags', questGiver: 'off', gossip: 'keep', waitMs: 0 },
          { kind: 'say', text: "Let's go.", style: 'say', waitMs: 0 },
          { kind: 'startEscort', points: [], run: false, waitMs: 0 },
        ],
      };
    case 'areaCredit':
      return {
        ...base, owner: { kind: 'areatrigger', id: 0, area: { map: 0, x: 0, y: 0, z: 0, radius: 5 } },
        trigger: { kind: 'enterArea' }, gates: [IN_LOG], steps: [{ kind: 'eventCredit', group: false, waitMs: 0 }],
      };
    case 'blank':
      return { ...base, owner: starter, trigger: { kind: 'talkedTo' }, gates: [], steps: [] };
  }
}
