import { z } from 'zod';
import { defineTool } from '../tool';

const SWITCH = 'Needs Debug mode switched on in Settings, Preferences (only the user can do that).';

/**
 * What the editor window is doing now, and a picture of it. Debug mode records a timeline of input, focus,
 * window and health events from both processes; these tools read it and probe the live window. All read-only
 * for the project; `screenshot` needs no setting.
 */
export const debugTools = [
  defineTool({
    name: 'debug_status',
    title: 'Debug mode status',
    description:
      'Whether Debug mode is on, how many events are held, where the log file is, and the window\'s focus state now (focused, contents focused, visible, minimised). Works with Debug mode off.',
    input: {},
    write: false,
    run: (_args, ctx) => ctx.call('debugStatus'),
  }),
  defineTool({
    name: 'debug_events',
    title: 'Debug events',
    description:
      'The recorded timeline, oldest first, from both the main process and the window: `input` (keys seen before the page and by the page, never the characters), `focus`, `window`, `dialog`, `health`, `error` and `probe` events, and an `orphan-key` event when a key reached a text field and nothing was typed. Filter by `since` (ms on the timeline, events strictly later), `categories` and `limit` (the newest are kept). Empty with Debug mode off.',
    input: { since: z.number().optional(), categories: z.array(z.string().max(40)).max(20).optional(), limit: z.number().int().min(1).max(1000).optional() },
    write: false,
    run: ({ since, categories, limit }, ctx) => {
      const query = { ...(since !== undefined ? { since } : {}), ...(categories ? { categories } : {}), ...(limit !== undefined ? { limit } : {}) };
      return ctx.call('debugEvents', Object.keys(query).length > 0 ? query : undefined);
    },
  }),
  defineTool({
    name: 'debug_snapshot',
    title: 'Debug snapshot',
    description: `Asks the window, now, where keyboard focus is: the active element, whether it can take text, any inert or aria-hidden ancestor, the open dialogs, and what sits over the field. Alongside it, the main process's view of the window. If the page does not answer within 2 seconds, only the main process's view comes back and \`rendererAnswered\` is false. ${SWITCH}`,
    input: {},
    write: false,
    run: (_args, ctx) => ctx.call('debugSnapshot'),
  }),
  defineTool({
    name: 'debug_type',
    title: 'Type into the window',
    description: `Sends real key presses (1 to 200 characters) to whatever has focus in the window, and reports the focused field's value before and after, whether it changed, and the events the typing produced. The live test of "does typing work now". ${SWITCH}`,
    input: { text: z.string().min(1).max(200) },
    write: false,
    run: ({ text }, ctx) => ctx.call('debugType', text),
  }),
  defineTool({
    name: 'screenshot',
    title: 'Screenshot',
    description:
      'A picture of the editor window, scaled to at most 1600 pixels wide (`maxWidth` to go smaller). Crop it to the element matching a CSS `selector`, or to a rectangle (`x`, `y`, `width`, `height` together, in window pixels). The window\'s focus state comes with it. Needs no setting; fails with a plain message when the window is hidden or minimised.',
    input: {
      selector: z.string().max(300).optional(),
      x: z.number().int().min(0).max(20000).optional(),
      y: z.number().int().min(0).max(20000).optional(),
      width: z.number().int().min(1).max(20000).optional(),
      height: z.number().int().min(1).max(20000).optional(),
      maxWidth: z.number().int().min(1).max(1600).optional(),
    },
    write: false,
    run: async ({ selector, x, y, width, height, maxWidth }, ctx) => {
      const given = [x, y, width, height].filter((v) => v !== undefined).length;
      if (given !== 0 && given !== 4) return { ok: false, error: { code: 'BAD_REQUEST', message: 'Give x, y, width and height together.' } };
      return ctx.call('captureScreenshot', {
        ...(selector ? { selector } : {}),
        ...(given === 4 ? { rect: { x: x!, y: y!, width: width!, height: height! } } : {}),
        ...(maxWidth !== undefined ? { maxWidth } : {}),
      });
    },
    present: ({ data: _data, mimeType: _mimeType, ...rest }: { data: string; mimeType: string }) => rest,
    image: (value: { data: string; mimeType: string }) => ({ data: value.data, mimeType: value.mimeType }),
  }),
];
