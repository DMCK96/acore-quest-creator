import { z } from 'zod';
import { AUTHORING_MODELS, describeAuthoring } from '../../../core/authoring';
import type { QuestAggregate } from '../../../core/model/aggregate';
import { describeScene } from '../../../core/scripts/describe';
import { SCRIPTS_FIELD, nextSceneId, readScenes, sceneSchema, writeScenes } from '../../../core/scripts/model';
import type { Result } from '../../../shared/ipc';
import { defineTool, type McpContext } from '../tool';

const questId = z.number().int().min(1);

/** A scene as the assistant writes it: the id may be left out, and is chosen for it. */
const sceneInput = sceneSchema.extend({ id: z.string().optional() });

const refused = (code: 'BAD_REQUEST' | 'QUEST_NOT_FOUND', message: string): Result<never> => ({ ok: false, error: { code, message } });

/** Every problem of a failed parse as `<path>: <reason>`, rooted at the argument's name. */
export const problemsOf = (error: z.ZodError, root: string): string =>
  error.issues.map((issue) => `${[root, ...issue.path.map(String)].join('.')}: ${issue.message}`).join(' ');

/** The aggregate of a quest that is in the project, or why it cannot be edited. */
async function projectQuest(ctx: McpContext, id: number): Promise<Result<QuestAggregate>> {
  const nodes = await ctx.call('listNodes');
  if (!nodes.ok) return nodes;
  if (!nodes.value.some((n) => n.questId === id)) {
    return refused('QUEST_NOT_FOUND', `Quest ${id} is not in this project. Call get_quest ${id} to bring it in, or new_quest to start one.`);
  }
  const opened = await ctx.call('openQuest', id);
  return opened.ok ? { ok: true, value: opened.value.aggregate } : opened;
}

/** Saves a quest's scenes and answers the quest's issues with them. */
async function saveScenes(ctx: McpContext, aggregate: QuestAggregate, scenes: ReturnType<typeof readScenes>): Promise<Result<unknown[]>> {
  const saved = await ctx.call('updateQuest', { ...aggregate, values: { ...aggregate.values, [SCRIPTS_FIELD]: writeScenes(scenes) } });
  if (!saved.ok) return saved;
  const issues = await ctx.call('validate', aggregate.questId);
  return issues.ok ? { ok: true, value: issues.value } : issues;
}

/** Writing scenes, fights, patrols and loot in the editor's own author-level models. */
export const authoringTools = [
  defineTool({
    name: 'describe_authoring',
    title: 'How to write a scene, fight, patrol, loot table, NPC, object or item',
    description:
      'Call this before writing a model. For one of scene, fight, patrol, loot, npc, object or item it returns the model\'s JSON Schema, a plain-language guide (what each trigger, step, reaction, field and kind means and when to use it, common mistakes, what the editor checks) and worked examples with their readings. Scenes are written with set_scene; fights, patrols and loot with set_npc_fight, set_npc_patrol and set_loot; new NPCs, objects and items start with new_entity.',
    input: { model: z.enum(AUTHORING_MODELS) },
    write: false,
    run: async ({ model }) => ({ ok: true, value: describeAuthoring(model) }),
  }),
  defineTool({
    name: 'get_scenes',
    title: "A quest's scenes",
    description:
      "The scenes of a quest that is in the project, each as written and read aloud in the editor's words, plus the quest's validation issues. Use it to see what exists before adding or changing a scene.",
    input: { questId },
    write: false,
    run: async ({ questId }, ctx) => {
      const quest = await projectQuest(ctx, questId);
      if (!quest.ok) return quest;
      const issues = await ctx.call('validate', questId);
      if (!issues.ok) return issues;
      const scenes = readScenes(quest.value.values).map((scene) => ({ scene, reading: describeScene(scene) }));
      return { ok: true, value: { questId, scenes, issues: issues.value } };
    },
  }),
  defineTool({
    name: 'set_scene',
    title: 'Add or replace a quest scene',
    description:
      "Adds a scene to a quest in the project, or replaces the scene with the same id. A scene is one trigger on one owner (an NPC, object or area) with optional gates and ordered steps: see describe_authoring with model scene for the schema, guide and examples. Leave `id` out to have one chosen. The scene is checked first and nothing changes if any part is wrong; on success the answer includes the editor's issues for the quest, which say what is still unfinished.",
    input: { questId, scene: z.record(z.string(), z.unknown()) },
    write: {
      kind: 'step',
      label: ({ questId, scene }: { questId: number; scene: Record<string, unknown> }) =>
        typeof scene?.['id'] === 'string' && scene['id'] !== '' ? `AI: set scene ${scene['id']} of quest ${questId}` : `AI: set scene of quest ${questId}`,
    },
    run: async ({ questId, scene }, ctx) => {
      const quest = await projectQuest(ctx, questId);
      if (!quest.ok) return quest;
      const parsed = sceneInput.safeParse(scene);
      if (!parsed.success) return refused('BAD_REQUEST', `Nothing was changed. ${problemsOf(parsed.error, 'scene')}`);

      const existing = readScenes(quest.value.values);
      const given = parsed.data.id;
      const id = given !== undefined && given !== '' ? given : nextSceneId(existing);
      const written = { ...parsed.data, id };
      const next = existing.some((s) => s.id === id) ? existing.map((s) => (s.id === id ? written : s)) : [...existing, written];

      const issues = await saveScenes(ctx, quest.value, next);
      return issues.ok ? { ok: true, value: { questId, sceneId: id, issues: issues.value } } : issues;
    },
  }),
  defineTool({
    name: 'remove_scene',
    title: 'Remove a quest scene',
    description: 'Removes the scene with this id from a quest in the project (see get_scenes for the ids). The other scenes are left as they are. A scene that another scene names (an escort a `waypointReached` trigger listens to) should be removed together with the scenes that name it.',
    input: { questId, sceneId: z.string().min(1) },
    write: { kind: 'step', label: ({ questId, sceneId }: { questId: number; sceneId: string }) => `AI: remove scene ${sceneId} of quest ${questId}` },
    run: async ({ questId, sceneId }, ctx) => {
      const quest = await projectQuest(ctx, questId);
      if (!quest.ok) return quest;
      const existing = readScenes(quest.value.values);
      if (!existing.some((s) => s.id === sceneId)) {
        return refused('BAD_REQUEST', `Quest ${questId} has no scene "${sceneId}". Its scenes are: ${existing.map((s) => s.id).join(', ') || '(none)'}.`);
      }
      const issues = await saveScenes(ctx, quest.value, existing.filter((s) => s.id !== sceneId));
      return issues.ok ? { ok: true, value: { questId, removed: sceneId, issues: issues.value } } : issues;
    },
  }),
];
