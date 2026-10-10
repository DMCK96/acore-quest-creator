import type { CustomNpc } from '../entities/model';
import type { Issue } from '../validate/validate';
import { describeTrigger } from './describe';
import type { QuestScene } from './model';
import { NPC_SCENE_LIMIT, needsQuest, type NpcScene } from './npc-scenes';
import { sceneIssues } from './validate';

/** The checks quest scenes have that still mean something for a scene an NPC owns */
const SHARED_CODES: ReadonlySet<string> = new Set(['SCENE_NO_PLAYER', 'SCENE_STEP_INCOMPLETE', 'SCENE_WRONG_OWNER']);

/** A scene as the quest checks read it: owned by the NPC, a pick from its own menu counting as being talked to */
function asQuestScene(npc: CustomNpc, scene: NpcScene): QuestScene {
  return {
    id: scene.id, name: scene.name, owner: { kind: 'creature', entry: npc.entry }, gates: scene.gates, steps: scene.steps,
    trigger: scene.trigger.kind === 'gossipPicked' ? { kind: 'talkedTo' } : scene.trigger,
  };
}

/** What is wrong with the scenes an NPC owns, each issue about the NPC (`about` is added by the caller) */
export function npcSceneIssues(input: {
  npc: CustomNpc;
  /** How the NPC is named in a message, e.g. `NPC "Hela"` */
  label: string;
  /** Whether a quest is in the project or the database */
  knownQuest: (id: number) => boolean;
  /** The NPC runs another AI or a script, so its scenes are not written */
  locked: boolean;
}): Issue[] {
  const { npc, label } = input;
  const scenes = npc.scenes;
  if (scenes.length === 0) return [];
  const issues: Issue[] = [];
  const add = (severity: Issue['severity'], code: string, message: string, fieldId = 'entities'): void => {
    issues.push({ severity, code, fieldId, message: `${label}: ${message}` });
  };

  if (input.locked || (npc.origin.kind === 'existing' && npc.origin.locked.includes('scenes'))) {
    add('warning', 'NPC_SCENES_LOCKED', 'it runs another AI or a script, so its scenes are not written.');
    return issues;
  }

  if (scenes.length > NPC_SCENE_LIMIT) add('error', 'NPC_SCENE_LIMIT', `an NPC can have ${NPC_SCENE_LIMIT} scenes; it has ${scenes.length}.`);
  const seen = new Set<string>();
  for (const scene of scenes) {
    if (seen.has(scene.id)) add('error', 'NPC_SCENE_ID_DUPLICATE', `two scenes share the id ${scene.id}.`);
    seen.add(scene.id);
  }

  const escorts = new Set(scenes.filter((s) => s.steps.some((step) => step.kind === 'startEscort')).map((s) => s.id));
  const options = new Map((npc.gossipMenu?.menus ?? []).map((m) => [m.menuId, m] as const));

  for (const scene of scenes) {
    const name = `Scene "${scene.name.trim() || describeTrigger(scene.trigger)}"`;
    const say = (severity: Issue['severity'], code: string, message: string): void => add(severity, code, `${name}: ${message}`);

    if (needsQuest(scene) && scene.questId === 0) say('error', 'NPC_SCENE_QUEST_NEEDED', 'choose the quest it is about.');
    if (scene.questId > 0 && !input.knownQuest(scene.questId)) {
      say('warning', 'NPC_SCENE_QUEST_UNKNOWN', `quest ${scene.questId} is not in the project or the database.`);
    }
    if (scene.steps.length === 0) say('warning', 'NPC_SCENE_NO_STEPS', 'it does nothing yet; add a step.');

    if (scene.trigger.kind === 'gossipPicked') {
      const menu = options.get(scene.trigger.menuId);
      const option = menu?.options.find((o) => o.optionId === (scene.trigger as { optionId: number }).optionId);
      if (!menu) {
        // A menu the NPC's tree does not hold is not this NPC's own to hang a scene on (or it has no tree at all)
        if (npc.gossipMenu === null) say('error', 'NPC_SCENE_OPTION_GONE', 'the NPC has no talk window for the option it waits for.');
        else say('error', 'NPC_SCENE_OPTION_LOCKED', `menu ${scene.trigger.menuId} is not this NPC's own menu.`);
      } else if (!option) {
        say('error', 'NPC_SCENE_OPTION_GONE', `option ${scene.trigger.optionId} is no longer in menu ${scene.trigger.menuId}.`);
      } else if (menu.locked || option.kept) {
        say('error', 'NPC_SCENE_OPTION_LOCKED', 'the option it waits for belongs to a menu or option the database shares, so it cannot be changed here.');
      }
    }

    if (scene.trigger.kind === 'waypointReached' && !escorts.has(scene.trigger.escortSceneId)) {
      say('error', 'NPC_SCENE_ESCORT', 'the escort it waits for is not one of this NPC\'s scenes.');
    }

    for (const issue of sceneIssues({
      questId: 0, scenes: [asQuestScene(npc, scene)], objectives: [], givers: [], enders: [], cppOwners: [], missingTables: [], specialFlags: 0,
    })) {
      if (SHARED_CODES.has(issue.code)) issues.push({ ...issue, fieldId: 'entities', message: `${label}: ${issue.message}` });
    }
  }
  return issues;
}
