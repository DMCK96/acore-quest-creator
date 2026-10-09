import { describe, expect, it } from 'vitest';
import { defineTool } from '../../src/main/mcp/tool';
import { mcpFixture } from '../helpers/mcp-fixture';

const newQuest = defineTool({
  name: 'make_one', title: 't', description: 'd', input: {}, write: { kind: 'step', label: () => 'AI: make one' },
  run: (_args, ctx) => ctx.call('newQuest'),
});
const failing = defineTool({
  name: 'fail', title: 't', description: 'd', input: {}, write: { kind: 'step', label: () => 'AI: fail' },
  run: async () => ({ ok: false, error: { code: 'UNKNOWN', message: 'nope' } }),
});

describe('the write guard and the window\'s quest edits', () => {
  it('holds them from the flush until after the change has been sent', async () => {
    const { call, holds } = await mcpFixture([newQuest]);
    await call('make_one');
    expect(holds).toEqual(['hold', 'notify', 'release']);
  });

  it('lets go when the tool fails', async () => {
    const { call, holds } = await mcpFixture([failing]);
    expect((await call('fail')).isError).toBe(true);
    expect(holds).toEqual(['hold', 'release']);
  });

  it('does not hold anything for a tool that only reads', async () => {
    const reader = defineTool({ name: 'look', title: 't', description: 'd', input: {}, write: false, run: async () => ({ ok: true, value: 1 }) });
    const { call, holds } = await mcpFixture([reader]);
    await call('look');
    expect(holds).toEqual([]);
  });
});
