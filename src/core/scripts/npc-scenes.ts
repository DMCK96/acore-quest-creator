import { z } from 'zod';
import { gateSchema, nextSceneId, stepSchema, triggerSchema } from './model';

/**
 * Scenes an NPC owns, whatever the quest: the quest scene minus its owner (always the NPC) plus the quest it
 * may name and a trigger for a pick from the NPC's own gossip menu. Compiled to SmartAI rows at export
 * (`npc-compile.ts`), tagged `AQC npc<entry> s<n>`.
 */

export const NPC_SCENE_LIMIT = 32;

const int = z.number().int();

const gossipPickedSchema = z.object({ kind: z.literal('gossipPicked'), menuId: int, optionId: int });

export const npcSceneSchema = z.object({
  id: z.string(),
  name: z.string(),
  questId: int.min(0),
  trigger: z.union([triggerSchema, gossipPickedSchema]),
  gates: z.array(gateSchema),
  steps: z.array(stepSchema),
});

export type NpcScene = z.infer<typeof npcSceneSchema>;
export type NpcTrigger = NpcScene['trigger'];
export type NpcTriggerKind = NpcTrigger['kind'];

/** The triggers an NPC's scene may have, in the order the editor lists them (an area is not an NPC's) */
export const NPC_TRIGGER_KINDS: readonly NpcTriggerKind[] = [
  'talkedTo', 'gossipOption', 'gossipPicked', 'spellHit', 'playerNear', 'dies', 'summoned', 'signal', 'waypointReached',
  'questAccepted', 'questHandedIn',
];

export function blankNpcScene(id: string): NpcScene {
  return { id, name: '', questId: 0, trigger: { kind: 'talkedTo' }, gates: [], steps: [] };
}

const QUEST_STEPS: ReadonlySet<string> = new Set(['credit', 'eventCredit', 'failQuest']);

/** Whether the scene acts on a quest, so it cannot work until one is chosen */
export function needsQuest(scene: NpcScene): boolean {
  return (
    scene.trigger.kind === 'questAccepted' ||
    scene.trigger.kind === 'questHandedIn' ||
    scene.steps.some((s) => QUEST_STEPS.has(s.kind)) ||
    scene.gates.some((g) => g.kind === 'quest' && g.questId === 0)
  );
}

/** `s<n+1>` past the highest in use */
export function nextNpcSceneId(scenes: readonly { id: string }[]): string {
  return nextSceneId(scenes);
}

/** An NPC that runs another AI or a C++ script is not ours to script */
export function scenesLocked(row: { AIName?: string | null; ScriptName?: string | null } | undefined): boolean {
  if (!row) return false;
  const ai = row.AIName ?? '';
  return (ai !== '' && ai !== 'SmartAI') || (row.ScriptName ?? '') !== '';
}
