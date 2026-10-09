import { z } from 'zod';
import type { Result } from '../../../shared/ipc';
import { defineTool } from '../tool';

const kind = z.enum(['npc', 'object', 'item']);
const entry = z.number().int().min(1);
const LIST = { npc: 'npcs', object: 'objects', item: 'items' } as const;

/** The project's own NPCs, objects and items, and the ones it borrows from the database. */
export const entityTools = [
  defineTool({
    name: 'list_project_entities',
    title: "The project's NPCs, objects and items",
    description: 'The new NPCs, objects and items the project defines (and existing ones it has taken over), each with all its fields.',
    input: {},
    write: false,
    run: (_args, ctx) => ctx.call('projectEntities'),
  }),
  defineTool({
    name: 'read_existing_entity',
    title: 'Read an NPC, object or item from the database',
    description:
      "An existing NPC, object or item as the world database has it, in the shape upsert_entity takes. Use it to adopt and change an existing one, or as a model for a new one.",
    input: { kind, entry },
    write: false,
    run: ({ kind, entry }, ctx) => ctx.call('readExistingEntity', kind, entry),
  }),
  defineTool({
    name: 'entity_template',
    title: 'Starting fields from an existing entity',
    description: 'The look and stats of an existing NPC (creature), object (gameobject) or item, to start a new one from; null when there is none.',
    input: { kind: z.enum(['creature', 'gameobject', 'item']), entry: z.number().int() },
    write: false,
    run: ({ kind, entry }, ctx) => ctx.call('entityTemplate', kind, entry),
  }),
  defineTool({
    name: 'allocate_ids',
    title: 'Free ids for new content',
    description:
      "Fresh ids for new NPCs (creature), objects (gameobject), their spawns, readable pages, items, gossip menus (gossipMenu) or their texts (gossipText), or trainers (a trainer's id, for an NPC that teaches spells): above everything in the database and the project, so they cannot collide. Nothing is reserved until you use them in upsert_entity.",
    input: { kind: z.enum(['creature', 'gameobject', 'creatureSpawn', 'gameobjectSpawn', 'page', 'item', 'trainer', 'gossipMenu', 'gossipText']), count: z.number().int().min(1).max(50) },
    write: false,
    run: ({ kind, count }, ctx) => ctx.call('allocateIds', kind, count),
  }),
  defineTool({
    name: 'upsert_entity',
    title: 'Save an NPC, object or item in the project',
    description:
      "Adds or replaces one NPC, object or item of the project; `entity` is the whole entity, with its `entry` id (take it from allocate_ids, or from read_existing_entity to change an existing one). Replaces the entity with the same entry. The editor checks the entity and refuses a malformed one.",
    input: { kind, entity: z.record(z.string(), z.unknown()) },
    write: { kind: 'step', label: ({ kind, entity }: { kind: string; entity: Record<string, unknown> }) => `AI: save ${kind} ${String(entity['entry'])}` },
    run: async ({ kind, entity }, ctx) => {
      const id = entity['entry'];
      if (typeof id !== 'number' || !Number.isInteger(id) || id < 1) {
        return { ok: false, error: { code: 'BAD_REQUEST', message: 'entity.entry must be a whole number from 1 up (see allocate_ids).' } } satisfies Result<never>;
      }
      const store = await ctx.call('projectEntities');
      if (!store.ok) return store;
      const key = LIST[kind];
      const list = store.value[key] as unknown as { entry: number }[];
      const next = list.some((e) => e.entry === id) ? list.map((e) => (e.entry === id ? entity : e)) : [...list, entity];
      const saved = await ctx.call('putProjectEntities', { ...store.value, [key]: next } as never);
      return saved.ok ? { ok: true, value: { kind, entry: id } } : saved;
    },
  }),
  defineTool({
    name: 'delete_entity',
    title: 'Delete an NPC, object or item from the project',
    description: "Deletes one of the project's NPCs, objects or items and clears it from every quest that named it (one undo step). Answers the quests it changed.",
    input: { kind, entry },
    write: { kind: 'step', label: ({ kind, entry }: { kind: string; entry: number }) => `AI: delete ${kind} ${entry}` },
    run: async ({ kind, entry }, ctx) => {
      const out = await ctx.call('deleteEntity', kind, entry);
      return out.ok ? { ok: true, value: { deleted: { kind, entry }, questsChanged: out.value.quests.map((q) => q.questId) } } : out;
    },
  }),
];
