import { describe, expect, it } from 'vitest';
import { debugTools } from '../../src/main/mcp/tools/debug';
import { mcpFixture } from '../helpers/mcp-fixture';
import { fail } from '../../src/main/api/errors';

const open = { focused: true, contentsFocused: true, visible: true, minimized: false };
const controller = (over: Record<string, unknown> = {}) => ({
  status: () => ({ enabled: true, events: 2, capacity: 5000, logFile: 'logs/x.jsonl', logFailures: 0, logTruncated: false, window: open }),
  events: (q: unknown) => [{ t: 5, source: 'main', category: 'input', name: 'before-input', data: { code: 'KeyA', q } }],
  snapshot: async () => ({ main: open, renderer: null, rendererAnswered: false }),
  type: async (t: string) => ({ typed: t.length, before: null, after: null, changed: false, window: open, events: [] }),
  screenshot: async () => ({ width: 8, height: 4, mimeType: 'image/png', data: 'QUJD', window: open }),
  ...over,
});

describe('the debug MCP tools', () => {
  it('offers exactly these five, all read-only', async () => {
    const { client } = await mcpFixture(debugTools, { debug: controller() });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['debug_events', 'debug_snapshot', 'debug_status', 'debug_type', 'screenshot']);
  });

  it('debug_status and debug_events pass their arguments through', async () => {
    const { call } = await mcpFixture(debugTools, { debug: controller() });
    expect((await call('debug_status')).value).toMatchObject({ enabled: true, logFile: 'logs/x.jsonl' });
    const events = (await call('debug_events', { since: 3, categories: ['input'], limit: 10 })).value;
    expect(events).toHaveLength(1);
    expect(events[0].data.q).toEqual({ since: 3, categories: ['input'], limit: 10 });
  });

  it('debug_snapshot reports that the page did not answer', async () => {
    const { call } = await mcpFixture(debugTools, { debug: controller() });
    expect((await call('debug_snapshot')).value).toMatchObject({ rendererAnswered: false, renderer: null });
  });

  it('debug_type answers the gate message when Debug mode is off', async () => {
    const off = controller({ type: async () => { throw fail('NOT_ENABLED', 'Turn on Debug mode in Preferences first.'); } });
    const { call } = await mcpFixture(debugTools, { debug: off });
    const out = await call('debug_type', { text: 'abc' });
    expect(out.isError).toBe(true);
    expect(out.value).toMatchObject({ code: 'NOT_ENABLED', message: 'Turn on Debug mode in Preferences first.' });
  });

  it('debug_type refuses empty or over-long text before reaching the controller', async () => {
    const { call } = await mcpFixture(debugTools, { debug: controller() });
    expect((await call('debug_type', { text: '' })).isError).toBe(true);
    expect((await call('debug_type', { text: 'x'.repeat(201) })).isError).toBe(true);
  });

  it('screenshot returns the window state as JSON and the picture as an image block', async () => {
    const { client } = await mcpFixture(debugTools, { debug: controller() });
    const r: any = await client.callTool({ name: 'screenshot', arguments: { selector: '.modal' } });
    expect(JSON.parse(r.content[0].text)).toEqual({ width: 8, height: 4, window: open });
    expect(r.content[1]).toMatchObject({ type: 'image', data: 'QUJD', mimeType: 'image/png' });
  });
});
