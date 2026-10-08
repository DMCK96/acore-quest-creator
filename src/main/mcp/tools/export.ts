import { z } from 'zod';
import { defineTool } from '../tool';

const questId = z.number().int().min(1);

/** Turning the project into SQL patches. Nothing here writes a database. */
export const exportTools = [
  defineTool({
    name: 'preview_changes',
    title: 'Preview a quest\'s database changes',
    description: "The rows exporting this project quest would change in the world database, cell by cell (before and after). Nothing is written.",
    input: { questId },
    write: false,
    run: ({ questId }, ctx) => ctx.call('previewChanges', questId),
  }),
  defineTool({
    name: 'test_commands',
    title: 'In-game test commands',
    description: 'The GM commands to try a quest in game once its patch is applied: reloads, restarts, teleport and quest commands.',
    input: { questId },
    write: false,
    run: ({ questId }, ctx) => ctx.call('testCommands', questId),
  }),
  defineTool({
    name: 'export_quest',
    title: 'Export a quest as an SQL patch',
    description:
      "Writes the quest's SQL patch file into the export folder and answers its path, the SQL and any warnings. A quest with errors is refused with the issues to fix (see validate_quest). Only a file is written; no database is touched, and the user applies the patch themselves.",
    input: { questId },
    write: { kind: 'step', label: ({ questId }: { questId: number }) => `Claude: export quest ${questId}` },
    run: async ({ questId }, ctx) => {
      const out = await ctx.call('exportQuest', questId);
      return out.ok ? { ok: true, value: { path: out.value.path, sql: out.value.sql, warnings: out.value.warnings, issues: out.value.issues } } : out;
    },
  }),
  defineTool({
    name: 'export_project',
    title: "Export the project's world changes as an SQL patch",
    description:
      "Writes the project patch (new NPCs, objects, items and world changes) and a revert patch into the export folder. Only files are written; no database is touched, and the user applies the patch themselves.",
    input: {},
    write: { kind: 'step', label: () => 'Claude: export project' },
    run: (_args, ctx) => ctx.call('exportProject'),
  }),
];
