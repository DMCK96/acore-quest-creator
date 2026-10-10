// tests/e2e/debug.e2e.ts
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { mkdtempSync, readdirSync } from 'node:fs';
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

test('Debug mode records nothing until switched on, reads back through MCP, and stops when switched off', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'acqc-ud-'));
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...withoutConnectionEnv(process.env), ACQC_USER_DATA: userData, ACQC_OUTPUT_DIR: mkdtempSync(join(tmpdir(), 'acqc-out-')), ACQC_ENV_FILE: 'none' },
  });
  running = app;
  const page = await app.firstWindow();
  const api = <T,>(call: string, ...args: unknown[]) => page.evaluate(([c, a]) => (globalThis as any).api[c as string](...(a as unknown[])), [call, args] as const) as Promise<{ ok: boolean; value: T; error?: { code: string; message: string } }>;

  const off: any = await api('debugStatus');
  expect(off.value).toMatchObject({ enabled: false, events: 0, logFile: null });
  const gated: any = await api('debugSnapshot');
  expect(gated).toMatchObject({ ok: false, error: { code: 'NOT_ENABLED', message: 'Turn on Debug mode in Preferences first.' } });

  const port = await freePort();
  const mcp: any = (await api('mcpConfigure', { enabled: true, port })).value;
  const client = new Client({ name: 'e2e', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(mcp.url), { requestInit: { headers: { authorization: `Bearer ${mcp.token}` } } }));
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['debug_status', 'debug_events', 'debug_snapshot', 'debug_type', 'screenshot']));

  // The screenshot needs no setting, but the window is shown only once it is ready to
  await expect.poll(async () => ((await api('debugStatus')).value as any).window?.visible).toBe(true);
  const shot: any = await client.callTool({ name: 'screenshot', arguments: { maxWidth: 400 } });
  expect(shot.isError, shot.content[0].text).toBeFalsy();
  expect(shot.content[1]).toMatchObject({ type: 'image', mimeType: 'image/png' });
  expect(shot.content[1].data.length).toBeGreaterThan(100);

  // Nothing is recorded while off
  await page.keyboard.press('KeyA');
  expect(JSON.parse(((await client.callTool({ name: 'debug_events', arguments: {} })) as any).content[0].text)).toEqual([]);

  // On: the window and the main process both record
  const on: any = await api('debugSetEnabled', true);
  expect(on.value.enabled).toBe(true);
  // A string, not a function: this project's test code has no browser types
  await page.evaluate(`document.body.insertAdjacentHTML('beforeend', '<input id="probe" aria-label="probe">'); document.getElementById('probe').focus();`);
  await page.keyboard.type('hi');
  await page.waitForTimeout(600);
  const events = JSON.parse(((await client.callTool({ name: 'debug_events', arguments: {} })) as any).content[0].text) as { source: string; category: string; name: string; data: Record<string, unknown> }[];
  expect(events.some((e) => e.source === 'renderer' && e.name === 'keydown' && e.data['code'] === 'KeyH')).toBe(true);
  expect(JSON.stringify(events)).not.toContain('"hi"');

  // The live probe: typing works, and the report says so
  const typed = JSON.parse(((await client.callTool({ name: 'debug_type', arguments: { text: 'ok' } })) as any).content[0].text);
  expect(typed).toMatchObject({ typed: 2, changed: true, after: { value: 'hiok' } });
  // Playwright's own keys go to the page over DevTools and never pass the main process; debug_type's do, so
  // the same keystroke is seen by both processes, which is what separates "never arrived" from "consumed"
  expect(typed.events.some((e: { source: string; name: string }) => e.source === 'main' && e.name === 'before-input')).toBe(true);
  expect(typed.events.some((e: { source: string; name: string; data: Record<string, unknown> }) => e.source === 'renderer' && e.name === 'keydown' && e.data['code'] === 'KeyO')).toBe(true);
  const snapshot = JSON.parse(((await client.callTool({ name: 'debug_snapshot', arguments: {} })) as any).content[0].text);
  expect(snapshot).toMatchObject({ rendererAnswered: true, renderer: { active: 'input#probe' } });

  // Off: recording stops and the log is closed with a file in place
  const status: any = (await api('debugSetEnabled', false)).value;
  expect(status).toMatchObject({ enabled: false, logFile: null });
  const before = (await api<unknown[]>('debugEvents')).value.length;
  await page.keyboard.type('zz');
  await page.waitForTimeout(600);
  expect((await api<unknown[]>('debugEvents')).value.length).toBe(before);
  expect(readdirSync(join(userData, 'logs')).filter((f) => /^debug-.*\.jsonl$/.test(f))).toHaveLength(1);
  await client.close();
});
