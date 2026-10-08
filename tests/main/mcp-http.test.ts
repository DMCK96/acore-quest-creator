import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startMcpHttp } from '../../src/main/mcp/http';
import { createMcpServer } from '../../src/main/mcp/server';
import { createWriteGuard } from '../../src/main/mcp/write-guard';
import { defineTool, type ToolDef } from '../../src/main/mcp/tool';
import { allTools } from '../../src/main/mcp/tools';
import { mcpFixture } from '../helpers/mcp-fixture';

const running: { close(): Promise<void> }[] = [];
afterEach(async () => { await Promise.all(running.splice(0).map((s) => s.close())); });

async function boot(token = 'tok', tools: readonly ToolDef[] = allTools) {
  const fx = await mcpFixture(tools);
  const current = { token };
  const guard = createWriteGuard();
  const server = await startMcpHttp({ port: 0, token: () => current.token, createServer: () => createMcpServer(fx.ctx, tools, guard) });
  running.push(server);
  return { server, current, url: `http://127.0.0.1:${server.port}/mcp`, fx };
}
const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } };
const post = (url: string, headers: Record<string, string>, body: unknown = initialize) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(body) });
const connectClient = async (url: string, token = 'tok') => {
  const client = new Client({ name: 't', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  return client;
};

describe('the MCP HTTP server', () => {
  it('answers a client that has the token, end to end', async () => {
    const { url } = await boot();
    const client = await connectClient(url);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('project_state');
    await client.close();
  });

  it('refuses a missing or wrong token with 401', async () => {
    const { url } = await boot();
    expect((await post(url, {})).status).toBe(401);
    expect((await post(url, { authorization: 'Bearer nope' })).status).toBe(401);
    expect((await post(url, { authorization: 'Bearer tok' })).status).toBe(200);
  });

  it('refuses a web page from another origin, and accepts a loopback or absent origin', async () => {
    const { url } = await boot();
    const auth = { authorization: 'Bearer tok' };
    expect((await post(url, { ...auth, origin: 'http://evil.example' })).status).toBe(403);
    expect((await post(url, { ...auth, origin: 'http://localhost:3000' })).status).toBe(200);
  });

  it('refuses a Host that is not loopback (DNS rebinding)', async () => {
    const { server } = await boot();
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: server.port, path: '/mcp', method: 'POST', headers: { host: 'evil.example', authorization: 'Bearer tok', 'content-type': 'application/json', accept: 'application/json, text/event-stream' } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
      req.on('error', reject);
      req.end(JSON.stringify(initialize));
    });
    expect(status).toBe(403);
  });

  it('serves only POST /mcp', async () => {
    const { url, server } = await boot();
    expect((await fetch(url, { method: 'GET', headers: { authorization: 'Bearer tok' } })).status).toBe(405);
    expect((await post(`http://127.0.0.1:${server.port}/other`, { authorization: 'Bearer tok' })).status).toBe(404);
  });

  it('answers a body that is not JSON with 400', async () => {
    const { url } = await boot();
    const res = await fetch(url, { method: 'POST', headers: { authorization: 'Bearer tok', 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{nope' });
    expect(res.status).toBe(400);
  });

  it('uses a regenerated token from the next request on', async () => {
    const { url, current } = await boot('old');
    expect((await post(url, { authorization: 'Bearer old' })).status).toBe(200);
    current.token = 'new';
    expect((await post(url, { authorization: 'Bearer old' })).status).toBe(401);
    expect((await post(url, { authorization: 'Bearer new' })).status).toBe(200);
  });

  it('listens on loopback only, and a second server on the same port says it is in use', async () => {
    const { server } = await boot();
    expect(server.address).toBe('127.0.0.1');
    await expect(startMcpHttp({ port: server.port, token: () => 't', createServer: () => { throw new Error('unused'); } })).rejects.toThrow(/already in use/);
  });

  it('stops listening when closed', async () => {
    const { url, server } = await boot();
    await server.close();
    await expect(post(url, { authorization: 'Bearer tok' })).rejects.toThrow();
  });

  it('keeps writes from two clients at once apart, one step each', async () => {
    const slow = (name: string) =>
      defineTool({
        name, title: name, description: `Makes two new quests slowly (${name}).`, input: {}, write: { kind: 'step', label: () => `Claude: ${name}` },
        run: async (_a, ctx) => { await ctx.call('newQuest'); await new Promise((r) => setTimeout(r, 20)); await ctx.call('newQuest'); return { ok: true, value: name }; },
      });
    const { url, fx } = await boot('tok', [slow('a'), slow('b')]);
    const [one, two] = await Promise.all([connectClient(url), connectClient(url)]);
    await Promise.all([one.callTool({ name: 'a', arguments: {} }), two.callTool({ name: 'b', arguments: {} })]);
    expect(fx.changes).toHaveLength(2);
    expect(fx.changes.map((c) => c.quests.length)).toEqual([2, 2]);
    await Promise.all([one.close(), two.close()]);
  });
});
