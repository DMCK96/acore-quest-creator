import type { ProjectGossip } from '../entities/gossip-tree';
import type { CustomNpc } from '../entities/model';
import { compileUnits, type CompiledScripts, type SceneUnit, type UnitScope } from './compile';
import type { ScriptContext } from './context';
import { needsQuest, scenesLocked } from './npc-scenes';
import { entitySceneTag, npcRowOwner, npcSceneFromComment, npcSceneIdOf, npcTriggerComment } from './tag';

/**
 * The scenes NPCs own, to SmartAI rows: the quest scene compiler's body, with every scene tagged
 * `AQC npc<entry> s<n>` and acting on the quest it names. Rows of a scene since removed are found by
 * their tag and deleted; the database's own rows, and the fights' and patrols', are only ever read.
 * An NPC that runs another AI or a C++ script gets nothing written, and nothing deleted.
 */

const DATA_MARKER = ' #aqc=';

const num = (raw: string | null | undefined): number => {
  if (raw === null || raw === undefined) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
};

export function compileNpcScenes(input: {
  npcs: readonly CustomNpc[];
  /** Each quest's `quest_template.RequiredNpcOrGo` by quest id; index 0 is objective 1. */
  objectives: ReadonlyMap<number, readonly number[]>;
  context: ScriptContext;
  /** What the fight and patrol compilers wrote in this export: its rows are as good as taken. */
  taken?: CompiledScripts;
  gossip?: ProjectGossip;
}): CompiledScripts {
  const { npcs, objectives, context } = input;
  const rowOf = new Map(context.creatures.map((r) => [num(r.entry), r]));
  const writable = npcs.filter(
    (n) => !scenesLocked(rowOf.get(n.entry)) && !(n.origin.kind === 'existing' && n.origin.locked.includes('scenes')),
  );
  const entries = new Set(writable.map((n) => n.entry));

  const keyOf = (comment: string | null | undefined): string | null => {
    const entry = npcRowOwner(comment, 'scene');
    const id = entry === null ? null : npcSceneIdOf(comment, entry);
    return entry !== null && id !== null && entries.has(entry) ? `${entry}/${id}` : null;
  };
  const scope: UnitScope = {
    keyOf,
    unreadable: (comment) => keyOf(comment) !== null && comment!.includes(DATA_MARKER) && npcSceneFromComment(comment) === null,
    unreadableWarning: (key) => {
      const [entry, id] = key.split('/');
      return `Scene ${id} of NPC ${entry} could not be read, so its rows are left as they are.`;
    },
    // A scene that listens to an option of the NPC's tree added none, so deleting its row must leave the tree's option alone
    addedOption: (comment) => npcSceneFromComment(comment)?.trigger.kind === 'gossipOption',
    objectives: (questId) => objectives.get(questId) ?? [],
  };

  const warnings: string[] = [];
  const units: SceneUnit[] = [];
  for (const npc of writable) {
    if (npc.entry <= 0) continue;
    for (const scene of npc.scenes) {
      if (needsQuest(scene) && scene.questId === 0) {
        warnings.push(`NPC ${npc.entry} scene ${scene.id} needs a quest, so it was not written.`);
        continue;
      }
      units.push({
        key: `${npc.entry}/${scene.id}`,
        siblingKey: (id) => `${npc.entry}/${id}`,
        id: scene.id,
        tag: entitySceneTag(npc.entry, scene.id),
        header: npcTriggerComment(npc.entry, scene),
        questId: scene.questId,
        owner: { kind: 'creature', entry: npc.entry },
        trigger: scene.trigger,
        gates: scene.gates,
        steps: scene.steps,
      });
    }
  }
  const out = compileUnits({ units, scope, context, taken: input.taken, gossip: input.gossip });
  out.warnings.push(...warnings);
  return out;
}
