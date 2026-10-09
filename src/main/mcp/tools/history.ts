import { defineTool } from '../tool';

/** Taking the AI's (or the user's) latest step back, or putting it forward again. */
export const historyTools = [
  defineTool({
    name: 'undo',
    title: 'Undo the last step',
    description: "Undoes the project's most recent step, whoever made it (see history_list), and answers its label, or null when there is nothing to undo.",
    input: {},
    write: { kind: 'travel' },
    run: (_args, ctx) => ctx.call('historyUndo'),
    present: (change: { step: { label: string } | null }) => ({ undid: change.step?.label ?? null }),
  }),
  defineTool({
    name: 'redo',
    title: 'Redo the last undone step',
    description: 'Does the most recently undone step again, and answers its label, or null when there is nothing to redo.',
    input: {},
    write: { kind: 'travel' },
    run: (_args, ctx) => ctx.call('historyRedo'),
    present: (change: { step: { label: string } | null }) => ({ redid: change.step?.label ?? null }),
  }),
];
