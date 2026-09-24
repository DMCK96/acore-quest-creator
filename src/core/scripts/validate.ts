import type { Issue } from '../validate/validate';
import { describeStep, describeTrigger } from './describe';
import {
  SCRIPTS_FIELD,
  stepNeedsPlayer,
  stepOwners,
  triggerHasPlayer,
  triggerOwners,
  type QuestScene,
  type SceneOwner,
} from './model';

export interface SceneCheckInput {
  questId: number;
  scenes: readonly QuestScene[];
  /** `quest_template.RequiredNpcOrGo` as four signed entries; index 0 is objective 1. */
  objectives: readonly number[];
  givers: readonly SceneOwner[];
  enders: readonly SceneOwner[];
  /** Owners whose template runs a C++ script, as `creature:<entry>` or `gameobject:<entry>`. */
  cppOwners: readonly string[];
  /** Script tables the connected fork does not have. */
  missingTables: readonly string[];
  /** `quest_template_addon.SpecialFlags`. */
  specialFlags: number;
}

/** `QUEST_SPECIAL_FLAGS_EXPLORATION_OR_EVENT`: the quest completes when a script says so. */
const EVENT_FLAG = 2;

const OWNER_WORDS = { creature: 'an NPC', gameobject: 'an object', areatrigger: 'an area' } as const;

const ownerKey = (owner: SceneOwner): string =>
  owner.kind === 'areatrigger' ? `areatrigger:${owner.id}` : `${owner.kind}:${owner.entry}`;

const sameOwner = (a: SceneOwner, b: SceneOwner): boolean => ownerKey(a) === ownerKey(b);

/** What is wrong with the quest's scenes, each issue routed to the Scripts module. */
export function sceneIssues(input: SceneCheckInput): Issue[] {
  const issues: Issue[] = [];
  const escorts = new Set(input.scenes.filter((s) => s.steps.some((step) => step.kind === 'startEscort')).map((s) => s.id));

  for (const scene of input.scenes) {
    const label = `Scene "${scene.name.trim() || describeTrigger(scene.trigger)}"`;
    const add = (severity: Issue['severity'], code: string, message: string): void => {
      issues.push({ severity, code, fieldId: SCRIPTS_FIELD, message: `${label}: ${message}` });
    };
    const owner = scene.owner;
    const kind = owner.kind;

    const hasOwner = owner.kind === 'areatrigger' ? owner.id > 0 || owner.area !== undefined : owner.entry > 0;
    if (!hasOwner) add('error', 'SCENE_NO_OWNER', 'choose the NPC, object or area it runs on.');

    if (!triggerOwners(scene.trigger.kind).includes(kind)) {
      add('error', 'SCENE_WRONG_OWNER', `"${describeTrigger(scene.trigger)}" cannot happen to ${OWNER_WORDS[kind]}.`);
    }
    for (const step of scene.steps) {
      if (!stepOwners(step.kind).includes(kind)) {
        add('error', 'SCENE_WRONG_OWNER', `${OWNER_WORDS[kind]} cannot ${describeStep(step)}.`);
      }
    }

    if (scene.steps.length === 0) add('warning', 'SCENE_NO_STEPS', 'it does nothing yet; add a step.');

    if (input.cppOwners.includes(ownerKey(owner))) {
      add('warning', 'SCENE_OWNER_CPP', 'this owner runs a C++ script, so the server will ignore scenes written for it.');
    }

    if (scene.trigger.kind === 'questAccepted' && !input.givers.some((g) => sameOwner(g, owner))) {
      add('warning', 'SCENE_ACCEPT_NOT_GIVER', 'this owner does not offer the quest, so accepting it will not set the scene off.');
    }
    if (scene.trigger.kind === 'questHandedIn' && !input.enders.some((e) => sameOwner(e, owner))) {
      add('warning', 'SCENE_ACCEPT_NOT_GIVER', 'this owner does not take the quest back, so handing it in will not set the scene off.');
    }

    if (!triggerHasPlayer(scene.trigger) && scene.steps.some((step) => stepNeedsPlayer(step))) {
      add('error', 'SCENE_NO_PLAYER', 'no player sets this trigger off, so steps that act on the player cannot run.');
    }

    if (kind === 'areatrigger' && scene.steps.some((step) => step.waitMs > 0)) {
      add('error', 'SCENE_AREA_WAIT', 'areas cannot wait between steps; set every wait to 0.');
    }

    for (const step of scene.steps) {
      if (step.kind === 'credit' && !((input.objectives[step.objective - 1] ?? 0) > 0)) {
        add('error', 'SCENE_CREDIT_EMPTY', `objective ${step.objective} is not an NPC objective of this quest.`);
      }
    }

    if (scene.steps.some((s) => s.kind === 'eventCredit' || s.kind === 'startEscort') && (input.specialFlags & EVENT_FLAG) === 0) {
      add('warning', 'SCENE_EVENT_FLAG', 'the quest is not set to complete from a script event, so this will not complete it.');
    }

    if (scene.trigger.kind === 'waypointReached' && !escorts.has(scene.trigger.escortSceneId)) {
      add('error', 'SCENE_NO_ESCORT', 'the escort it waits for no longer exists.');
    }

    const needs = new Set<string>(['smart_scripts']);
    if (scene.steps.some((s) => s.kind === 'say')) needs.add('creature_text');
    if (scene.steps.some((s) => s.kind === 'startEscort')) needs.add('waypoints');
    if (scene.gates.length > 0) needs.add('conditions');
    if (scene.trigger.kind === 'gossipOption') for (const t of ['gossip_menu', 'gossip_menu_option', 'npc_text']) needs.add(t);
    if (kind === 'areatrigger') needs.add('areatrigger_scripts');
    const missing = [...needs].filter((t) => input.missingTables.includes(t));
    if (missing.length > 0) {
      add('error', 'SCENE_TABLE_MISSING', `the connected database has no ${missing.join(', ')} table, which this scene needs.`);
    }
  }
  return issues;
}
