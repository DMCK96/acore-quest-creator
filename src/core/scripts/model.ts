import { z } from 'zod';
import type { FieldValue } from '../registry/types';

/**
 * Quest scripting as the author sees it: scenes of "when this happens to this NPC, object or area,
 * and only when these hold, do these steps in order". Scenes are stored in the quest's values under
 * `SCRIPTS_FIELD` and compiled into SmartAI rows at export (`compile.ts`); nothing else reads the
 * key, so this file is the one place that knows its shape.
 */

export const SCRIPTS_FIELD = 'scripts';

const int = z.number().int();
const num = z.number().finite();

export const positionSchema = z.object({ x: num, y: num, z: num, o: num });
const areaSchema = z.object({ map: int, x: num, y: num, z: num, radius: num });

const ownerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('creature'), entry: int }),
  z.object({ kind: z.literal('gameobject'), entry: int }),
  z.object({ kind: z.literal('areatrigger'), id: int, area: areaSchema.optional() }),
]);

const triggerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('questAccepted') }),
  z.object({ kind: z.literal('questHandedIn') }),
  z.object({ kind: z.literal('spellHit'), spellId: int }),
  z.object({ kind: z.literal('dies') }),
  z.object({ kind: z.literal('talkedTo') }),
  z.object({ kind: z.literal('gossipOption'), text: z.string(), greeting: z.string() }),
  z.object({ kind: z.literal('playerNear'), range: num }),
  z.object({ kind: z.literal('enterArea') }),
  z.object({ kind: z.literal('signal'), signal: int }),
  z.object({ kind: z.literal('waypointReached'), escortSceneId: z.string(), point: int }),
  z.object({ kind: z.literal('summoned') }),
]);

const gateSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('quest'),
    questId: int,
    state: z.enum(['inLog', 'objectivesDone', 'handedIn', 'neverTaken']),
    negate: z.boolean(),
  }),
  z.object({ kind: z.literal('item'), item: int, count: int, negate: z.boolean() }),
  z.object({ kind: z.literal('team'), team: z.enum(['alliance', 'horde']) }),
]);

const wait = { waitMs: int.min(0) };
const toggle = z.enum(['on', 'off', 'keep']);

const stepSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('say'), text: z.string(), style: z.enum(['say', 'yell', 'emote']), ...wait }),
  z.object({ kind: z.literal('emote'), emote: int, ...wait }),
  z.object({ kind: z.literal('credit'), objective: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]), group: z.boolean(), ...wait }),
  z.object({ kind: z.literal('eventCredit'), group: z.boolean(), ...wait }),
  z.object({ kind: z.literal('failQuest'), ...wait }),
  z.object({ kind: z.literal('castOnPlayer'), spellId: int, ...wait }),
  z.object({ kind: z.literal('castOnSelf'), spellId: int, ...wait }),
  z.object({ kind: z.literal('giveItem'), item: int, count: int, ...wait }),
  z.object({ kind: z.literal('takeItem'), item: int, count: int, ...wait }),
  z.object({ kind: z.literal('spawnNpc'), entry: int, at: positionSchema, despawnAfterS: int.min(0), attackPlayer: z.boolean(), ...wait }),
  z.object({ kind: z.literal('spawnObject'), entry: int, at: positionSchema, despawnAfterS: int.min(0), ...wait }),
  z.object({ kind: z.literal('despawn'), entry: int, range: num, ...wait }),
  z.object({ kind: z.literal('moveTo'), at: positionSchema, ...wait }),
  z.object({ kind: z.literal('startEscort'), points: z.array(positionSchema), run: z.boolean(), ...wait }),
  z.object({ kind: z.literal('npcFlags'), questGiver: toggle, gossip: toggle, ...wait }),
  z.object({ kind: z.literal('faction'), faction: int, ...wait }),
  z.object({ kind: z.literal('objectState'), state: z.enum(['open', 'closed']), entry: int, range: num, ...wait }),
  z.object({ kind: z.literal('signal'), signal: int, targetKind: z.enum(['creature', 'gameobject']), entry: int, range: num, ...wait }),
  z.object({ kind: z.literal('closeGossip'), ...wait }),
]);

export const sceneSchema = z.object({
  id: z.string(),
  name: z.string(),
  owner: ownerSchema,
  trigger: triggerSchema,
  gates: z.array(gateSchema),
  steps: z.array(stepSchema),
});

export type Position = z.infer<typeof positionSchema>;
export type AreaDef = z.infer<typeof areaSchema>;
export type SceneOwner = z.infer<typeof ownerSchema>;
export type SceneTrigger = z.infer<typeof triggerSchema>;
export type SceneGate = z.infer<typeof gateSchema>;
export type SceneStep = z.infer<typeof stepSchema>;
/** A step without its wait, for code that only cares what the step does. */
export type StepBody = SceneStep extends infer S ? (S extends SceneStep ? Omit<S, 'waitMs'> : never) : never;
export type QuestScene = z.infer<typeof sceneSchema>;
export type OwnerKind = SceneOwner['kind'];
export type TriggerKind = SceneTrigger['kind'];
export type StepKind = SceneStep['kind'];

/** Every scene stored on the quest; anything that is not a valid scene is left out, never thrown. */
export function readScenes(values: Readonly<Record<string, unknown>>): QuestScene[] {
  const raw = values[SCRIPTS_FIELD];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const parsed = sceneSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * Scenes in the shape the values map carries. The registry's value types describe table columns;
 * scenes are nested data no column holds, so this is the one place they are passed off as one.
 */
export function writeScenes(scenes: readonly QuestScene[]): FieldValue {
  return scenes as unknown as FieldValue;
}

/** `s<n+1>` past the highest `s<n>` in use, so a removed scene's id is never handed out again. */
export function nextSceneId(scenes: readonly QuestScene[]): string {
  let highest = 0;
  for (const scene of scenes) {
    const match = /^s(\d+)$/.exec(scene.id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `s${highest + 1}`;
}

const CREATURE: readonly OwnerKind[] = ['creature'];
const LIVING: readonly OwnerKind[] = ['creature', 'gameobject'];
const ANY: readonly OwnerKind[] = ['creature', 'gameobject', 'areatrigger'];
const AREA: readonly OwnerKind[] = ['areatrigger'];

const TRIGGER_OWNERS: Record<TriggerKind, readonly OwnerKind[]> = {
  questAccepted: LIVING,
  questHandedIn: LIVING,
  spellHit: LIVING,
  dies: CREATURE,
  talkedTo: LIVING,
  // An object's gossip menu lives in type-specific data fields, so only NPCs get options for now.
  gossipOption: CREATURE,
  playerNear: CREATURE,
  enterArea: AREA,
  signal: LIVING,
  waypointReached: CREATURE,
  summoned: CREATURE,
};

const STEP_OWNERS: Record<StepKind, readonly OwnerKind[]> = {
  say: CREATURE,
  emote: LIVING,
  credit: ANY,
  eventCredit: ANY,
  failQuest: ANY,
  castOnPlayer: ANY,
  castOnSelf: LIVING,
  giveItem: ANY,
  takeItem: ANY,
  spawnNpc: LIVING,
  spawnObject: LIVING,
  despawn: LIVING,
  moveTo: CREATURE,
  startEscort: CREATURE,
  npcFlags: CREATURE,
  faction: CREATURE,
  objectState: LIVING,
  signal: LIVING,
  closeGossip: LIVING,
};

/** The owners that can carry this trigger in SmartAI. */
export function triggerOwners(kind: TriggerKind): readonly OwnerKind[] {
  return TRIGGER_OWNERS[kind];
}

/** The owners that can run this step. */
export function stepOwners(kind: StepKind): readonly OwnerKind[] {
  return STEP_OWNERS[kind];
}

const NO_PLAYER: ReadonlySet<TriggerKind> = new Set(['waypointReached', 'signal', 'summoned']);

/** Whether a player sets this trigger off, so steps can act on them. A death's invoker is the killer. */
export function triggerHasPlayer(trigger: SceneTrigger): boolean {
  return !NO_PLAYER.has(trigger.kind);
}

const NEEDS_PLAYER: ReadonlySet<StepKind> = new Set([
  'credit', 'eventCredit', 'failQuest', 'castOnPlayer', 'giveItem', 'takeItem', 'startEscort', 'closeGossip',
]);

/** Whether the step acts on the player who set the scene off. */
export function stepNeedsPlayer(step: StepBody): boolean {
  return NEEDS_PLAYER.has(step.kind);
}
