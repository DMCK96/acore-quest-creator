import { test, expect, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import { BAD_MODEL, LAVA_MAP, MISSING_MODEL, START, startFakeClient, type FakeClient } from './fake-client';

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
    // Listed up front: a dependency Vite finds late (the workers import some) reloads the page mid-test.
    optimizeDeps: { entries: ['tests/world3d/harness.html'], include: ['three', '@tweenjs/tween.js', '@wowserhq/format', '@wowserhq/io'] },
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
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text());
  });
  await openPage(page);
  await open(page, 'azeroth', 0);
  await page.waitForFunction('window.__state.ready', null, { timeout: 45000 });

  // Both broken props are reported by name, with where they failed...
  await expect.poll(async () => (await state(page)).problems.length).toBe(2);
  const { problems } = await state(page);
  expect(problems.find((p) => p.includes(BAD_MODEL))).toMatch(/could not be loaded: Invalid typed array length/);
  expect(problems.find((p) => p.includes(MISSING_MODEL))).toMatch(/404/);
  // ... but textures are not: a grey stand-in leaves nothing out, and modded clients lack many by design.
  // They go to the console only: a garbage one with what it starts with (to tell it from a format not
  // read), a missing one with the building that asked for it. The uncompressed one is not a problem at all.
  expect(problems.some((p) => /\.blp/.test(p))).toBe(false);
  await expect.poll(() => warnings.find((w) => /tileset.garbage\.blp/.test(w))).toMatch(/begins 67 67 67/);
  await expect.poll(() => warnings.find((w) => /tileset.missing\.blp/.test(w))).toMatch(/\(used by building World.wmo.test.house\.wmo\) could not be loaded/);
  expect(warnings.some((w) => /tileset.raw\.blp/.test(w))).toBe(false);
  // All four of the building's groups load, however their files are written: not one is reported.
  expect(problems.some((p) => /house_00\d/.test(p))).toBe(false);
  for (const part of ['house_000', 'house_001', 'house_002', 'house_003']) expect(client.requested).toContain(`200 world/wmo/test/${part}.wmo`);
  // ... and the ground is on screen: the middle of the picture is the green terrain, not the sky.
  const picture = await page.locator('canvas.world3d__canvas').screenshot();
  await test.info().attach('terrain', { body: picture, contentType: 'image/png' });
  // WORLD3D_SHOT=<file.png> keeps the picture, to look at
  if (process.env['WORLD3D_SHOT']) writeFileSync(process.env['WORLD3D_SHOT'], picture);
  const [r, g, b] = (await page.evaluate(`window.__pixel(${JSON.stringify(picture.toString('base64'))}, 0.5, 0.8)`)) as number[];
  expect(g!).toBeGreaterThan(r!);
  expect(g!).toBeGreaterThan(b!);
  // The building stands at the middle of the picture: its roof is the brick colour, not terrain or sky.
  const [roofR, , roofB] = (await page.evaluate(`window.__pixel(${JSON.stringify(picture.toString('base64'))}, 0.5, 0.5)`)) as number[];
  expect(roofR!).toBeGreaterThan(roofB! + 60);
  expect(client.requested).toContain('200 tileset/grass.blp');
  // A building's water (MLIQ) is drawn: the terrain here has none, so only the house's pool asks for a flipbook
  await expect.poll(() => client.requested.includes('200 xtextures/river/lake_a.1.blp'), { timeout: 10000 }).toBe(true);
});

test('draws liquid: magma covering a tile, its look read from LiquidType.dbc and its flipbook only as long as it is', async ({ page }) => {
  const shaderErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /shader|program/i.test(message.text())) shaderErrors.push(message.text());
  });
  await openPage(page);
  await open(page, LAVA_MAP.directory, 1);
  await page.waitForFunction('window.__state.ready', null, { timeout: 45000 });
  await expect.poll(() => client.requested.includes('200 xtextures/lava/lava.2.blp'), { timeout: 20000 }).toBe(true);
  await page.waitForTimeout(1500);

  // The surface is above the terrain everywhere: the middle of the picture is the lava's red, unlit
  const picture = await page.locator('canvas.world3d__canvas').screenshot();
  await test.info().attach('lava', { body: picture, contentType: 'image/png' });
  if (process.env['WORLD3D_SHOT']) writeFileSync(process.env['WORLD3D_SHOT'].replace(/\.png$/, '-lava.png'), picture);
  const [r, g, b] = (await page.evaluate(`window.__pixel(${JSON.stringify(picture.toString('base64'))}, 0.5, 0.7)`)) as number[];
  expect(r!).toBeGreaterThan(g! + 60);
  expect(r!).toBeGreaterThan(b! + 60);

  // Its type came from the client's LiquidType.dbc, and frames were asked for up to the first missing one
  expect(client.requested).toContain('200 dbfilesclient/liquidtype.dbc');
  expect(client.requested).toContain('404 xtextures/lava/lava.3.blp');
  expect(client.requested.some((r) => r.includes('lava.4.blp'))).toBe(false);
  expect(shaderErrors).toEqual([]);
  expect((await state(page)).errors).toEqual([]);
});

test('the camera looks around in place on a right-drag and flies forward on W', async ({ page }) => {
  await openPage(page);
  await open(page, 'azeroth', 0);
  await page.waitForFunction('window.__state.ready', null, { timeout: 45000 });
  type Camera = { position: { x: number; y: number; z: number }; direction: { x: number; y: number; z: number } };
  const camera = async () => (await page.evaluate('window.__camera()')) as Camera;
  const box = (await page.locator('canvas.world3d__canvas').boundingBox())!;
  const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];

  const before = await camera();
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(cx + 200, cy, { steps: 10 });
  await page.mouse.up({ button: 'right' });
  const looked = await camera();
  // Turned (the direction changed) without moving: not the wide orbit that read as a fast pan
  const moved = Math.hypot(looked.position.x - before.position.x, looked.position.y - before.position.y, looked.position.z - before.position.z);
  expect(moved).toBeLessThan(0.01);
  const dot = before.direction.x * looked.direction.x + before.direction.y * looked.direction.y + before.direction.z * looked.direction.z;
  expect(dot).toBeLessThan(0.95);

  // The view has focus from the click: W flies the way it now looks
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(600);
  await page.keyboard.up('KeyW');
  const flown = await camera();
  const step = { x: flown.position.x - looked.position.x, y: flown.position.y - looked.position.y, z: flown.position.z - looked.position.z };
  const length = Math.hypot(step.x, step.y, step.z);
  expect(length).toBeGreaterThan(5);
  expect((step.x * looked.direction.x + step.y * looked.direction.y + step.z * looked.direction.z) / length).toBeGreaterThan(0.99);
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

test('every model shader compiles, and none the game uses is missing', async ({ page }) => {
  await openPage(page);
  const result = (await page.evaluate('window.__compileModelShaders()')) as { failures: string[]; unimplemented: string[] };
  expect(result.failures).toEqual([]);
  // The game's shaders 0-22 are all implemented (a missing one drew its model without its leaves).
  expect(result.unimplemented).toEqual([]);
});
