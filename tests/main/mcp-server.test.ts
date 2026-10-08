import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool } from '../../src/main/mcp/tool';
import { mcpFixture } from '../helpers/mcp-fixture';

const echo = defineTool({
  name: 'echo', title: 'Echo', description: 'Returns its argument.', input: { text: z.string() }, write: false,
  run: async ({ text }) => ({ ok: true, value: { text } }),
});
const refuse = defineTool({
  name: 'refuse', title: 'Refuse', description: 'Always fails.', input: {}, write: false,
  run: async () => ({ ok: false, error: { code: 'VALIDATION', message: 'fix it', issues: [{ severity: 'error', fieldId: 'x', message: 'bad' }] as any } }),
});
const explode = defineTool({
  name: 'explode', title: 'Explode', description: 'Throws.', input: {}, write: false,
  run: async () => { throw new Error('boom'); },
});
const huge = defineTool({
  name: 'huge', title: 'Huge', description: 'Returns a very long answer.', input: {}, write: false,
  run: async () => ({ ok: true, value: { blob: 'x'.repeat(300_000) } }),
});

const bigWrite = defineTool({
  name: 'big_write', title: 'Big write', description: 'Changes the project and returns a very long answer.', input: {},
  write: { kind: 'step', label: () => 'AI: big write' },
  run: async (_a, ctx) => { await ctx.call('newQuest'); return { ok: true, value: { sql: 'x'.repeat(300_000) } }; },
});

describe('the MCP server', () => {
  it('lists the tools with their descriptions', async () => {
    const { client } = await mcpFixture([echo, refuse]);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['echo', 'refuse']);
    expect(tools.find((t) => t.name === 'echo')!.description).toBe('Returns its argument.');
  });

  it('answers a successful call with the value as JSON text', async () => {
    const { call } = await mcpFixture([echo]);
    expect(await call('echo', { text: 'hi' })).toEqual({ isError: false, value: { text: 'hi' } });
  });

  it('answers a failed call as a tool error that keeps code, message and issues', async () => {
    const { call } = await mcpFixture([refuse]);
    const out = await call('refuse');
    expect(out.isError).toBe(true);
    expect(out.value.code).toBe('VALIDATION');
    expect(out.value.message).toBe('fix it');
    expect(out.value.issues).toHaveLength(1);
  });

  it('refuses arguments that do not match the input schema', async () => {
    const { call } = await mcpFixture([echo]);
    expect((await call('echo', { text: 5 })).isError).toBe(true);
  });

  it('turns a thrown error into a tool error with code UNKNOWN', async () => {
    const { call } = await mcpFixture([explode]);
    const out = await call('explode');
    expect(out.isError).toBe(true);
    expect(out.value).toEqual({ code: 'UNKNOWN', message: 'boom' });
  });

  it('will not send an answer over 200000 characters; it asks the caller to narrow the request', async () => {
    const { call } = await mcpFixture([huge]);
    const out = await call('huge');
    expect(out.isError).toBe(true);
    expect(out.value.code).toBe('BAD_REQUEST');
    expect(out.value.message).toMatch(/too large/i);
    expect(out.value.message).toMatch(/narrow/i);
  });

  it('tells the caller to connect first when the editor is not connected', async () => {
    const { call } = await mcpFixture([defineTool({ name: 'needs_db', title: 'Needs db', description: 'Calls a lookup that needs the database.', input: {}, write: false, run: (_a, ctx) => ctx.call('searchQuests', 'x') })], { connect: false });
    const out = await call('needs_db');
    expect(out.value.code).toBe('NOT_CONNECTED');
    expect(out.value.message).toMatch(/connect/i);
    expect(out.value.message).toMatch(/list_profiles/);
  });

  it('keeps a change that was made, and says so, when its answer is too large to send', async () => {
    const { call, api } = await mcpFixture([bigWrite]);
    const out = await call('big_write');
    expect(out.isError).toBe(false);
    expect(out.value.note).toMatch(/too large/i);
    expect(JSON.stringify(out.value).length).toBeLessThan(2000);
    expect(((await api.historyList()) as any).value.steps.map((s: any) => s.label)).toEqual(['AI: big write']);
  });
});
