import { z } from 'zod';
import { AUTHORING_MODELS, authoringSchema, describeAuthoring } from '../../../core/authoring';
import { patrolInputSchema } from '../../../core/authoring/models';
import { newItem, newNpc, newObject, type CustomItem, type CustomNpc, type CustomObject, type ProjectEntities } from '../../../core/entities/model';
import type { QuestAggregate } from '../../../core/model/aggregate';
import { describeScene } from '../../../core/scripts/describe';
import { SCRIPTS_FIELD, nextSceneId, sceneSchema, splitScenes, writeScenes, type QuestScene } from '../../../core/scripts/model';
import type { Issue } from '../../../core/validate/validate';
import type { Result } from '../../../shared/ipc';
import { defineTool, type McpContext } from '../tool';

const questId = z.number().int().min(1);

/** What the exporter recognises as one of the editor's scenes. */
const SCENE_ID = /^s\d+$/;

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

/**
 * What a change that is already made answers with: the editor's issues, or why they could not be
 * read. Failing to read them must not look like the change failing, or it would be made twice.
 */
async function answerIssues(load: () => Promise<Result<Issue[]>>): Promise<{ issues: Issue[]; issuesError?: string }> {
  const issues = await load();
  if (issues.ok) return { issues: issues.value };
  return { issues: [], issuesError: `The change was made, but the editor's issues could not be read (${issues.error.message}). Check again with validate_quest or check_project_entities.` };
}

/** Saves a quest's scenes (and the stored scenes that cannot be read, kept as they are) and answers the quest's issues with them. */
async function saveScenes(
  ctx: McpContext,
  aggregate: QuestAggregate,
  scenes: readonly QuestScene[],
  unreadable: readonly unknown[],
): Promise<Result<{ issues: Issue[]; issuesError?: string }>> {
  const saved = await ctx.call('updateQuest', { ...aggregate, values: { ...aggregate.values, [SCRIPTS_FIELD]: writeScenes(scenes, unreadable) } });
  if (!saved.ok) return saved;
  return { ok: true, value: await answerIssues(() => ctx.call('validate', aggregate.questId)) };
}

/** The id a stored entry carries, if it has one. */
const idOf = (entry: unknown): unknown => (entry as { id?: unknown } | null)?.id;

const sceneTools = [
  defineTool({
    name: 'describe_authoring',
    title: 'How to write a scene, fight, patrol, loot table, NPC, object, item or gossip menu',
    description:
      'Call this before writing a model. For one of scene, fight, patrol, loot, npc, object, item or gossip it returns the model\'s JSON Schema, a plain-language guide (what each trigger, step, reaction, field and kind means and when to use it, common mistakes, what the editor checks) and worked examples with their readings. Scenes are written with set_scene; fights, patrols and loot with set_npc_fight, set_npc_patrol and set_loot; new NPCs, objects and items start with new_entity.',
    input: { model: z.enum(AUTHORING_MODELS) },
    write: false,
    run: async ({ model }) => ({ ok: true, value: describeAuthoring(model) }),
  }),
  defineTool({
    name: 'get_scenes',
    title: "A quest's scenes",
    description:
      "The scenes of a quest that is in the project, each as written and read aloud in the editor's words, plus the quest's validation issues. Scenes stored on the quest that the editor cannot read are listed by id under `unreadable`; set_scene and remove_scene leave them as they are. Use it to see what exists before adding or changing a scene.",
    input: { questId },
    write: false,
    run: async ({ questId }, ctx) => {
      const quest = await projectQuest(ctx, questId);
      if (!quest.ok) return quest;
      const issues = await ctx.call('validate', questId);
      if (!issues.ok) return issues;
      const stored = splitScenes(quest.value.values);
      const scenes = stored.scenes.map((scene) => ({ scene, reading: describeScene(scene) }));
      const unreadable = stored.unreadable.map((entry) => idOf(entry)).filter((id): id is string => typeof id === 'string');
      return { ok: true, value: { questId, scenes, unreadable, issues: issues.value } };
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

      const { scenes: existing, unreadable } = splitScenes(quest.value.values);
      const given = parsed.data.id;
      if (given !== undefined && given !== '' && !SCENE_ID.test(given)) {
        return refused('BAD_REQUEST', `Nothing was changed. Scene ids look like s1, s2 (the letter s and a number, s<number>): "${given}" would not be recognised when the quest is exported again. Leave the id out to have one chosen.`);
      }
      // A stored scene that cannot be read keeps its id taken; writing a scene with that id is a replacement
      const id = given !== undefined && given !== '' ? given : nextSceneId([...existing, ...unreadable]);
      const written = { ...parsed.data, id };
      const next = existing.some((s) => s.id === id) ? existing.map((s) => (s.id === id ? written : s)) : [...existing, written];

      const saved = await saveScenes(ctx, quest.value, next, unreadable.filter((entry) => idOf(entry) !== id));
      return saved.ok ? { ok: true, value: { questId, sceneId: id, ...saved.value } } : saved;
    },
  }),
  defineTool({
    name: 'remove_scene',
    title: 'Remove a quest scene',
    description: 'Removes the scene with this id from a quest in the project (see get_scenes for the ids). The other scenes are left as they are, and so are stored scenes the editor cannot read, unless one of those is the id given. A scene that another scene names (an escort a `waypointReached` trigger listens to) should be removed together with the scenes that name it.',
    input: { questId, sceneId: z.string().min(1) },
    write: { kind: 'step', label: ({ questId, sceneId }: { questId: number; sceneId: string }) => `AI: remove scene ${sceneId} of quest ${questId}` },
    run: async ({ questId, sceneId }, ctx) => {
      const quest = await projectQuest(ctx, questId);
      if (!quest.ok) return quest;
      const { scenes: existing, unreadable } = splitScenes(quest.value.values);
      if (!existing.some((s) => s.id === sceneId) && !unreadable.some((entry) => idOf(entry) === sceneId)) {
        return refused('BAD_REQUEST', `Quest ${questId} has no scene "${sceneId}". Its scenes are: ${existing.map((s) => s.id).join(', ') || '(none)'}.`);
      }
      const saved = await saveScenes(ctx, quest.value, existing.filter((s) => s.id !== sceneId), unreadable.filter((entry) => idOf(entry) !== sceneId));
      return saved.ok ? { ok: true, value: { questId, removed: sceneId, ...saved.value } } : saved;
    },
  }),
];

type Kind = 'npc' | 'object' | 'item';
type Entity = CustomNpc | CustomObject | CustomItem;
const WORDS = { npc: 'NPC', object: 'Object', item: 'Item' } as const;
/** What each kind is called by the id allocator, and by an issue that is about one. */
const ALLOCATE = { npc: 'creature', object: 'gameobject', item: 'item' } as const;
const MAKE = { npc: newNpc, object: newObject, item: newItem } as const;

/** The project's issues about one entity, told apart by its entry (two may share a name). */
function issuesAbout(ctx: McpContext, kind: Kind, entry: number): Promise<{ issues: Issue[]; issuesError?: string }> {
  return answerIssues(async () => {
    const all = await ctx.call('projectIssues');
    return all.ok ? { ok: true, value: all.value.filter((issue) => issue.about?.kind === ALLOCATE[kind] && issue.about.entry === entry) } : all;
  });
}

/** The store with a new entity added to its list. */
function appended(store: ProjectEntities, kind: Kind, entity: Entity): ProjectEntities {
  switch (kind) {
    case 'npc':
      return { ...store, npcs: [...store.npcs, entity as CustomNpc] };
    case 'object':
      return { ...store, objects: [...store.objects, entity as CustomObject] };
    case 'item':
      return { ...store, items: [...store.items, entity as CustomItem] };
  }
}

/** Why a database entity's fight or loot may not be changed, or null when it may. */
function lockReason(entity: CustomNpc | CustomObject, part: 'fight' | 'loot', word: string): string | null {
  if (entity.origin.kind === 'existing' && entity.origin.locked.includes(part)) {
    return `${word} ${entity.entry} is a database ${word} whose ${part} is locked (the database's own scripts or shared loot would be overwritten). Make a new ${word} with new_entity instead.`;
  }
  return null;
}

/** One NPC of the project by entry, with the project's whole store, or why there is none. */
async function projectNpc(ctx: McpContext, entry: number): Promise<Result<{ store: ProjectEntities; npc: CustomNpc }>> {
  const store = await ctx.call('projectEntities');
  if (!store.ok) return store;
  const npc = store.value.npcs.find((n) => n.entry === entry);
  if (!npc) return refused('BAD_REQUEST', `There is no NPC ${entry} in this project. Make one with new_entity.`);
  return { ok: true, value: { store: store.value, npc } };
}

const entityTools = [
  defineTool({
    name: 'new_entity',
    title: 'Make a new NPC, object or item',
    description:
      "Adds a new NPC, object or item to the project with the editor's defaults and a free entry, and answers it with the editor's issues about it (a new NPC still needs a model, for example). `fields` sets anything else, by the names in describe_authoring for npc, object or item; it may not set entry, origin or spawns. Then use set_npc_fight, set_npc_patrol and set_loot. To place a new NPC or object, add spawns to it with upsert_entity, taking each spawn guid from allocate_ids (kind creatureSpawn or gameobjectSpawn); add_spawn only places existing database NPCs and objects.",
    input: { kind: z.enum(['npc', 'object', 'item']), name: z.string().trim().min(1, 'give it a name').max(100), fields: z.record(z.string(), z.unknown()).optional() },
    write: { kind: 'step', label: ({ kind }: { kind: string }) => `AI: new ${kind}` },
    run: async ({ kind, name, fields }, ctx) => {
      for (const key of ['entry', 'origin', 'spawns']) {
        if (fields && key in fields) return refused('BAD_REQUEST', `Nothing was changed. "${key}" is chosen by the editor and cannot be set in fields.`);
      }
      const known = Object.keys(MAKE[kind](0));
      const unknown = Object.keys(fields ?? {}).filter((key) => !known.includes(key));
      if (unknown.length > 0) {
        return refused('BAD_REQUEST', `Nothing was changed. ${WORDS[kind]}s have no field called ${unknown.join(', ')}. Their fields are: ${known.join(', ')}.`);
      }
      const allocated = await ctx.call('allocateIds', ALLOCATE[kind], 1);
      if (!allocated.ok) return allocated;
      const entry = allocated.value[0]!;
      const parsed = authoringSchema(kind).safeParse({ ...MAKE[kind](entry), ...fields, name });
      if (!parsed.success) return refused('BAD_REQUEST', `Nothing was changed. ${problemsOf(parsed.error, 'fields')}`);
      const entity = parsed.data as Entity;

      const store = await ctx.call('projectEntities');
      if (!store.ok) return store;
      const saved = await ctx.call('putProjectEntities', appended(store.value, kind, entity));
      if (!saved.ok) return saved;
      return { ok: true, value: { kind, entity, ...(await issuesAbout(ctx, kind, entity.entry)) } };
    },
  }),
  defineTool({
    name: 'set_npc_fight',
    title: "Set a new NPC's fight",
    description:
      "Sets (or, with null, removes) the fight of one of the project's NPCs: abilities on timers, reactions and phases. See describe_authoring with model fight. The fight is checked first and nothing changes if any part is wrong. An existing database NPC whose fight the editor has locked is refused. The answer includes the editor's issues about the NPC.",
    input: { entry: z.number().int().min(1), fight: z.union([z.record(z.string(), z.unknown()), z.null()]) },
    write: { kind: 'step', label: ({ entry }: { entry: number }) => `AI: set fight of ${entry}` },
    run: async ({ entry, fight }, ctx) => {
      const found = await projectNpc(ctx, entry);
      if (!found.ok) return found;
      const { store, npc } = found.value;
      const locked = lockReason(npc, 'fight', 'NPC');
      if (locked) return refused('BAD_REQUEST', locked);
      let next: CustomNpc['fight'] = null;
      if (fight !== null) {
        const parsed = authoringSchema('fight').safeParse(fight);
        if (!parsed.success) return refused('BAD_REQUEST', `Nothing was changed. ${problemsOf(parsed.error, 'fight')}`);
        next = parsed.data as CustomNpc['fight'];
      }
      const saved = await ctx.call('putProjectEntities', { ...store, npcs: store.npcs.map((n) => (n.entry === entry ? { ...n, fight: next } : n)) });
      if (!saved.ok) return saved;
      return { ok: true, value: { entry, fight: next !== null, ...(await issuesAbout(ctx, 'npc', entry)) } };
    },
  }),
  defineTool({
    name: 'set_npc_patrol',
    title: "Set a spawn's patrol",
    description:
      "Sets (or, with null, removes) the patrol of one spawn of one of the project's NPCs: points to walk in order and loop, with waits and actions. See describe_authoring with model patrol. The path id is chosen by the editor (any `pathId` you give is ignored). The spawn (by guid) must already be on the NPC. The answer includes the editor's issues about the NPC.",
    input: { entry: z.number().int().min(1), guid: z.number().int().min(1), patrol: z.union([z.record(z.string(), z.unknown()), z.null()]) },
    write: { kind: 'step', label: ({ entry }: { entry: number }) => `AI: set patrol of ${entry}` },
    run: async ({ entry, guid, patrol }, ctx) => {
      const found = await projectNpc(ctx, entry);
      if (!found.ok) return found;
      const { store, npc } = found.value;
      const spawn = npc.spawns.find((s) => s.guid === guid);
      if (!spawn) {
        return refused('BAD_REQUEST', `NPC ${entry} has no spawn ${guid}. Its spawns are: ${npc.spawns.map((s) => s.guid).join(', ') || '(none)'}.`);
      }
      let next: CustomNpc['spawns'][number]['patrol'] = null;
      if (patrol !== null) {
        const parsed = patrolInputSchema.safeParse(patrol);
        if (!parsed.success) return refused('BAD_REQUEST', `Nothing was changed. ${problemsOf(parsed.error, 'patrol')}`);
        // The editor owns the path id: any given one is ignored (it could be another route's), and the
        // spawn keeps the one it already has when its patrol is set again
        const own = spawn.patrol?.pathId;
        let pathId = typeof own === 'number' && own > 0 ? own : 0;
        if (pathId === 0) {
          const allocated = await ctx.call('patrolPathId', guid);
          if (!allocated.ok) return allocated;
          pathId = allocated.value;
        }
        next = { ...parsed.data, pathId } as NonNullable<typeof next>;
      }
      const npcs = store.npcs.map((n) => (n.entry === entry ? { ...n, spawns: n.spawns.map((s) => (s.guid === guid ? { ...s, patrol: next } : s)) } : n));
      const saved = await ctx.call('putProjectEntities', { ...store, npcs });
      if (!saved.ok) return saved;
      return { ok: true, value: { entry, guid, patrol: next, ...(await issuesAbout(ctx, 'npc', entry)) } };
    },
  }),
  defineTool({
    name: 'set_loot',
    title: "Set a new NPC's or object's loot",
    description:
      "Replaces the loot of one of the project's NPCs or objects: rows of { item, chance (percent), min, max, questOnly }. See describe_authoring with model loot. An existing database NPC or object whose loot the editor has locked is refused. Only a chest object can be looted: for any other object type the loot is saved but not exported, and the answer says so under `warning`. The answer includes the editor's issues about it.",
    input: { kind: z.enum(['npc', 'object']), entry: z.number().int().min(1), rows: z.array(z.record(z.string(), z.unknown())) },
    write: { kind: 'step', label: ({ entry }: { entry: number }) => `AI: set loot of ${entry}` },
    run: async ({ kind, entry, rows }, ctx) => {
      const store = await ctx.call('projectEntities');
      if (!store.ok) return store;
      const entity: CustomNpc | CustomObject | undefined = (kind === 'npc' ? store.value.npcs : store.value.objects).find((e) => e.entry === entry);
      if (!entity) return refused('BAD_REQUEST', `There is no ${WORDS[kind]} ${entry} in this project. Make one with new_entity.`);
      const locked = lockReason(entity, 'loot', WORDS[kind]);
      if (locked) return refused('BAD_REQUEST', locked);
      const parsed = authoringSchema('loot').safeParse(rows);
      if (!parsed.success) return refused('BAD_REQUEST', `Nothing was changed. ${problemsOf(parsed.error, 'rows')}`);
      const loot = parsed.data as CustomNpc['loot'];
      const next: ProjectEntities =
        kind === 'npc'
          ? { ...store.value, npcs: store.value.npcs.map((e) => (e.entry === entry ? { ...e, loot } : e)) }
          : { ...store.value, objects: store.value.objects.map((e) => (e.entry === entry ? { ...e, loot } : e)) };
      const saved = await ctx.call('putProjectEntities', next);
      if (!saved.ok) return saved;
      const warning =
        kind === 'object' && 'pages' in entity && entity.type !== 'chest' && loot.length > 0
          ? `Object ${entry} is a ${entity.type}, not a chest, and only a chest can be looted: this loot is saved but will not be exported. Change its type to chest with upsert_entity.`
          : undefined;
      return { ok: true, value: { kind, entry, rows: loot.length, ...(warning ? { warning } : {}), ...(await issuesAbout(ctx, kind, entry)) } };
    },
  }),
  defineTool({
    name: 'check_project_entities',
    title: "Check the project's NPCs, objects and items",
    description: "What the editor finds wrong with every new NPC, object and item in the project (errors stop an export, warnings do not), each issue naming the one it is about. Use it after building several things.",
    input: {},
    write: false,
    run: (_args, ctx) => ctx.call('projectIssues'),
  }),
];

/** Writing scenes, fights, patrols and loot in the editor's own author-level models. */
export const authoringTools = [...sceneTools, ...entityTools];
