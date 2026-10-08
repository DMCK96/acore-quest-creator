import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { fieldById, registry } from '../../../core/registry';
import { checkFieldValue } from '../../../core/registry/check-value';
import type { FieldDef } from '../../../core/registry/types';
import type { Result } from '../../../shared/ipc';
import { defineTool } from '../tool';

const questId = z.number().int().min(1);

/** A field as the model should see it: its id, what it is for, and what values it takes. */
const describeField = (f: FieldDef) => ({
  id: f.id,
  label: f.label,
  help: f.help,
  group: f.group,
  shape: f.shape,
  advanced: f.advanced ?? false,
  type:
    f.shape === 'scalar'
      ? f.type
      : f.shape === 'list'
        ? { kind: 'list', slots: f.slots, members: f.members.map((m) => ({ name: m.name, label: m.label, type: m.type })) }
        : { kind: 'rowset', columns: f.columns.map((c) => ({ name: c.name, label: c.label, type: c.type })) },
});

const refused = (code: 'BAD_REQUEST' | 'QUEST_NOT_FOUND', message: string): Result<never> => ({ ok: false, error: { code, message } });

/** Quests: reading and editing the ones in the project, and bringing in ones from the database. */
export const questTools = [
  defineTool({
    name: 'describe_quest_fields',
    title: 'Describe the quest fields',
    description:
      'Every field of a quest the editor can read and write: its id (used by set_quest_fields), label, what it is for, and the values it takes (text, whole numbers with limits, enums with their allowed values, flags, id references, lists of rows). Call this before set_quest_fields. Quest text is written in English (enUS).',
    input: {},
    write: false,
    run: async () => ({ ok: true, value: registry.fields.map(describeField) }),
  }),
  defineTool({
    name: 'list_quests',
    title: 'Quests in the project',
    description: "The quests on the project's canvas: id, title, level, whether new or already exported, error and warning counts, and the quests each one links to.",
    input: {},
    write: false,
    run: async (_args, ctx) => {
      const nodes = await ctx.call('listNodes');
      if (!nodes.ok) return nodes;
      return {
        ok: true,
        value: nodes.value.map((n) => ({
          questId: n.questId,
          title: n.title,
          level: n.level,
          isNew: n.isNew,
          exported: n.exported,
          errors: n.errors,
          warnings: n.warnings,
          links: n.links.map((l) => ({ to: l.to, component: l.component })),
        })),
      };
    },
  }),
  defineTool({
    name: 'get_quest',
    title: 'Open a quest',
    description:
      "Reads a quest with every field value and its validation issues. A quest from the world database is IMPORTED onto the project's canvas (one undo step) so it can be edited; a quest already in the project is just read. Use search_quests to find ids.",
    input: { questId },
    write: { kind: 'step', label: ({ questId }: { questId: number }) => `Claude: open quest ${questId}` },
    run: async ({ questId }, ctx) => {
      const opened = await ctx.call('openQuest', questId);
      if (!opened.ok) return opened;
      const v = opened.value;
      return { ok: true, value: { questId: v.questId, inProject: v.inProject, stale: v.stale, locales: v.locales, issues: v.issues, aggregate: v.aggregate } };
    },
  }),
  defineTool({
    name: 'new_quest',
    title: 'Start a new quest',
    description: "Adds an empty new quest to the project, with a free id from the project's id range, and returns it. Fill it in with set_quest_fields.",
    input: {},
    write: { kind: 'step', label: () => 'Claude: new quest' },
    run: async (_args, ctx) => {
      const made = await ctx.call('newQuest');
      return made.ok ? { ok: true, value: { questId: made.value.questId, aggregate: made.value.aggregate } } : made;
    },
  }),
  defineTool({
    name: 'add_quest_chain',
    title: 'Import a quest chain',
    description: "Imports a quest from the world database together with every quest chained to it onto the project's canvas (one undo step). Answers the ids added and whether the chain was cut short.",
    input: { questId },
    write: { kind: 'step', label: ({ questId }: { questId: number }) => `Claude: add quest chain from ${questId}` },
    run: async ({ questId }, ctx) => {
      const chain = await ctx.call('addQuestChain', questId);
      return chain.ok ? { ok: true, value: { questIds: chain.value.questIds, truncated: chain.value.truncated } } : chain;
    },
  }),
  defineTool({
    name: 'set_quest_fields',
    title: 'Edit quest fields',
    description:
      "Sets fields of a quest that is in the project (use get_quest or new_quest first). `fields` maps a field id to its new value; call describe_quest_fields to see the ids and what each takes. Every value is checked first and nothing changes if any is wrong. Answers which fields changed and the quest's validation issues. Text is English (enUS).",
    input: { questId, fields: z.record(z.string(), z.unknown()) },
    write: { kind: 'step', label: ({ questId }: { questId: number }) => `Claude: edit quest ${questId}` },
    run: async ({ questId, fields }, ctx) => {
      const nodes = await ctx.call('listNodes');
      if (!nodes.ok) return nodes;
      if (!nodes.value.some((n) => n.questId === questId)) {
        return refused('QUEST_NOT_FOUND', `Quest ${questId} is not in this project. Call get_quest ${questId} to bring it in, or new_quest to start one.`);
      }
      const opened = await ctx.call('openQuest', questId);
      if (!opened.ok) return opened;
      const aggregate = opened.value.aggregate;

      const problems: string[] = [];
      for (const [id, value] of Object.entries(fields)) {
        const field = fieldById(id);
        const locked = aggregate.readOnly.find((r) => r.fieldId === id);
        if (!field) problems.push(`"${id}" is not a quest field (see describe_quest_fields).`);
        else if (locked) problems.push(`"${id}" cannot be edited on this quest: ${locked.reason}`);
        else {
          const problem = checkFieldValue(field, value);
          if (problem) problems.push(`"${id}": ${problem}`);
        }
      }
      if (problems.length > 0) return refused('BAD_REQUEST', `Nothing was changed. ${problems.join(' ')}`);

      const changed = Object.keys(fields).filter((id) => !isDeepStrictEqual(aggregate.values[id], fields[id]));
      if (changed.length > 0) {
        const values = { ...aggregate.values, ...fields } as typeof aggregate.values;
        const saved = await ctx.call('updateQuest', { ...aggregate, values });
        if (!saved.ok) return saved;
      }
      const issues = await ctx.call('validate', questId);
      if (!issues.ok) return issues;
      return { ok: true, value: { questId, changed, issues: issues.value } };
    },
  }),
  defineTool({
    name: 'validate_quest',
    title: 'Check a quest',
    description: 'The problems the editor finds in a project quest (errors block export, warnings do not), each with the field it is about.',
    input: { questId },
    write: false,
    run: ({ questId }, ctx) => ctx.call('validate', questId),
  }),
  defineTool({
    name: 'quest_links',
    title: 'Quest links',
    description: 'How the quests are linked: prerequisites, follow-ups, groups and rotations touching these project quests, described in words.',
    input: { questIds: z.array(questId).max(500) },
    write: false,
    run: ({ questIds }, ctx) => ctx.call('questLinks', questIds),
  }),
  defineTool({
    name: 'remove_quest',
    title: 'Remove a quest from the project',
    description: "Takes a quest off the project's canvas (one undo step). The world database is not touched.",
    input: { questId },
    write: { kind: 'step', label: ({ questId }: { questId: number }) => `Claude: remove quest ${questId}` },
    run: ({ questId }, ctx) => ctx.call('removeNode', questId),
  }),
];
