import { test, expect, type Page } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import { BAD_MODEL, MISSING_MODEL, START, startFakeClient, type FakeClient } from './fake-client';

/**
 * The real 3D code (Three.js, the vendored Wowser scene, its workers) in a real browser, reading a
 * fake game client over HTTP. It stands in for the parts of the app that need a game client, which
 * a test machine does not have.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const PAGE = 'http://127.0.0.1:5199/tests/world3d/harness.html';

let client: FakeClient;
let vite: ViteDevServer;

test.beforeAll(async () => {
  client = await startFakeClient(5200);
  vite = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'error',
    resolve: {
      alias: [
        { find: '@core/client/asset-url', replacement: resolve(HERE, 'asset-url-stub.ts') },
        { find: '@core', replacement: resolve(ROOT, 'src/core') },
        { find: '@shared', replacement: resolve(ROOT, 'src/shared') },
      ],
    },
    // Only the harness is scanned for dependencies, not the whole app.
    optimizeDeps: { entries: ['tests/world3d/harness.html'] },
    server: { port: 5199, strictPort: true, host: '127.0.0.1' },
  });
  await vite.listen();
});

test.afterAll(async () => {
  await vite?.close();
  await client?.close();
});

// What the page keeps (see harness.html). Strings, not functions: this project has no browser types.
interface PageState {
  ready: boolean;
  problems: string[];
  errors: string[];
}
const state = async (page: Page): Promise<PageState> => (await page.evaluate('window.__state')) as PageState;
const open = (page: Page, directory: string, map: number): Promise<unknown> =>
  page.evaluate(`window.__open(${JSON.stringify(directory)}, ${map}, ${JSON.stringify(START)})`);

async function openPage(page: Page): Promise<void> {
  await page.goto(PAGE);
  await page.waitForFunction('window.__loaded === true');
}

test('draws the terrain, and a model or texture that cannot be read costs the area neither its terrain nor its other props', async ({ page }) => {
  await openPage(page);
  await open(page, 'azeroth', 0);
  await page.waitForFunction('window.__state.ready', null, { timeout: 45000 });

  // Both broken props are reported by name, with where they failed...
  await expect.poll(async () => (await state(page)).problems.length).toBe(3);
  const { problems } = await state(page);
  expect(problems.find((p) => p.includes(BAD_MODEL))).toMatch(/could not be loaded: Invalid typed array length/);
  expect(problems.find((p) => p.includes(MISSING_MODEL))).toMatch(/404/);
  // ... as is a texture that is garbage (with what it starts with, to tell it from a format not read); the
  // uncompressed one is not a problem at all.
  expect(problems.find((p) => /tileset.garbage\.blp/.test(p))).toMatch(/begins 67 67 67/);
  expect(problems.some((p) => /tileset.raw\.blp/.test(p))).toBe(false);
  // ... and the ground is on screen: the middle of the picture is the green terrain, not the sky.
  const picture = await page.locator('canvas.world3d__canvas').screenshot();
  await test.info().attach('terrain', { body: picture, contentType: 'image/png' });
  const [r, g, b] = (await page.evaluate(`window.__pixel(${JSON.stringify(picture.toString('base64'))}, 0.5, 0.8)`)) as number[];
  expect(g!).toBeGreaterThan(r!);
  expect(g!).toBeGreaterThan(b!);
  expect(client.requested).toContain('200 tileset/grass.blp');
});

test('a world can be left and another opened, again and again, without an error', async ({ page }) => {
  await openPage(page);
  for (const [directory, map] of [['azeroth', 0], ['kalimdor', 1], ['azeroth', 0], ['northrend', 571]] as const) {
    await open(page, directory, map);
    await page.waitForTimeout(1200);
  }
  await page.evaluate('window.__close()');
  // Maps the fake client has no terrain for (kalimdor, northrend) fail to load, and say so; nothing throws.
  const { errors } = await state(page);
  expect(errors.filter((e) => !/Error loading asset: 404/.test(e) && !/Failed to fetch/.test(e))).toEqual([]);
});
