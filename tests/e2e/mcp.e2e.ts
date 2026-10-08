import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const withoutConnectionEnv = (env: NodeJS.ProcessEnv): Record<string, string> =>
  Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => e[1] !== undefined && !/^ACQC_(WORLD|DEV)_DB_/.test(e[0])));

const freePort = (): Promise<number> =>
  new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });

let running: ElectronApplication | undefined;
test.afterEach(async () => {
  await running?.close();
  running = undefined;
});

test('the MCP server is off until switched on, then answers a client with the token, and stops when switched off', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...withoutConnectionEnv(process.env), ACQC_USER_DATA: mkdtempSync(join(tmpdir(), 'acqc-ud-')), ACQC_OUTPUT_DIR: mkdtempSync(join(tmpdir(), 'acqc-out-')), ACQC_ENV_FILE: 'none' },
  });
  running = app;
  const page = await app.firstWindow();
  const port = await freePort();

  const off = await page.evaluate(() => (window as any).api.mcpStatus());
  expect(off.value).toMatchObject({ enabled: false, running: false });

  const on = await page.evaluate((p) => (window as any).api.mcpConfigure({ enabled: true, port: p }), port);
  expect(on.value).toMatchObject({ enabled: true, running: true, port, error: null });
  const { url, token } = on.value as { url: string; token: string };

  const noToken = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' });
  expect(noToken.status).toBe(401);

  const client = new Client({ name: 'e2e', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['project_state', 'set_quest_fields', 'undo']));
  const state: any = await client.callTool({ name: 'project_state', arguments: {} });
  expect(JSON.parse(state.content[0].text).name).toBeTruthy();
  await client.close();

  await page.evaluate(() => (window as any).api.mcpConfigure({ enabled: false, port: 47600 }));
  await expect(fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}` } })).rejects.toThrow();
});
