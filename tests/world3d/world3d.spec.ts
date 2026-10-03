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
  selected: { kind: string; guid: number; event: { id: number } | null } | null;
  edits: any[];
  notices: string[];
  escapes: number;
  placed: { target: { kind: string; entry: number }; at: { x: number; y: number; z: number; orientation: number; rotation: number[] | null } }[];
  placeEnds: number;
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

test('draws spawns: a marker where a display cannot be drawn, and asks the client for a creature display\'s model', async ({ page }) => {
  await openPage(page);
  // Away from the house, which stands at START and whose roof would hide what is under it
  const SPOT = { x: START.x + 60, y: START.y - 60, z: START.z };
  // One NPC at the camera's target with display 1 (Test.m2, which the fake client lacks) and one with display 0
  await page.evaluate(`window.__spawns = { creatures: [
    { guid: 1, entry: 1, name: 'A', map: 0, x: ${SPOT.x}, y: ${SPOT.y}, z: ${SPOT.z}, orientation: 0, displayId: 1, scale: 4, wander: 0, path: null, equipment: [0,0,0], own: false },
    { guid: 2, entry: 1, name: 'B', map: 0, x: ${SPOT.x + 3}, y: ${SPOT.y}, z: ${SPOT.z}, orientation: 0, displayId: 0, scale: 4, wander: 0, path: null, equipment: [0,0,0], own: false }
  ], objects: [], capped: { creatures: false, objects: false } }`);
  await page.evaluate(`window.__open('azeroth', 0, ${JSON.stringify(SPOT)})`);
  await page.waitForFunction('window.__state.ready', null, { timeout: 45000 });
  await expect.poll(() => client.requested.includes('200 dbfilesclient/creaturedisplayinfo.dbc'), { timeout: 15000 }).toBe(true);
  await expect.poll(() => client.requested.includes('404 creature/test/test.m2'), { timeout: 15000 }).toBe(true);
  await page.waitForTimeout(1000);
  const picture = await page.locator('canvas.world3d__canvas').screenshot();
  const [r, g, b] = (await page.evaluate(`window.__pixel(${JSON.stringify(picture.toString('base64'))}, 0.5, 0.5)`)) as number[];
  // The creature marker's orange (0xe0a040) stands at the middle of the picture
  expect(r!).toBeGreaterThan(b! + 80);
  expect(g!).toBeGreaterThan(b!);
  // Hidden, the middle is terrain again, not the marker
  await page.evaluate('window.__setVisibility({ creatures: false, objects: true, paths: true })');
  await page.waitForTimeout(300);
  const hidden = await page.locator('canvas.world3d__canvas').screenshot();
  const after = (await page.evaluate(`window.__pixel(${JSON.stringify(hidden.toString('base64'))}, 0.5, 0.5)`)) as number[];
  expect(after).not.toEqual([r, g, b, 255]);
});

test('a click selects the NPC under it, and event spawns only once they are shown', async ({ page }) => {
  await openPage(page);
  const SPOT = { x: START.x + 60, y: START.y - 60, z: START.z };
  // A marker NPC at the camera's target (the middle of the picture), and one that only comes with an event
  await page.evaluate(`window.__spawns = { creatures: [
    { guid: 5, entry: 1, name: 'Here', map: 0, x: ${SPOT.x}, y: ${SPOT.y}, z: ${SPOT.z}, orientation: 0, displayId: 0, scale: 4, wander: 0, path: null, equipment: [0,0,0], own: false, event: null },
    { guid: 6, entry: 1, name: 'Holiday', map: 0, x: ${SPOT.x - 6}, y: ${SPOT.y - 6}, z: ${SPOT.z}, orientation: 0, displayId: 0, scale: 4, wander: 0, path: null, equipment: [0,0,0], own: false, event: { id: 12, name: 'Fair' } }
  ], objects: [], capped: { creatures: false, objects: false } }`);
  await page.evaluate(`window.__open('azeroth', 0, ${JSON.stringify(SPOT)})`);
  await page.waitForFunction('window.__state.ready', null, { timeout: 45000 });
  await page.waitForTimeout(1000);
  const canvas = page.locator('canvas.world3d__canvas');
  const box = (await canvas.boundingBox())!;
  const click = async (fx: number, fy: number) => {
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
    return (await state(page)).selected;
  };

  expect(await click(0.5, 0.5)).toMatchObject({ kind: 'creature', guid: 5, event: null });
  // Off to the side of everything: nothing selected
  expect(await click(0.05, 0.9)).toBeNull();

  // The event NPC stands between the camera and the first: hidden by default, so the click reaches the first
  await page.evaluate('window.__setVisibility({ creatures: true, objects: true, paths: true, events: true })');
  await page.waitForTimeout(500);
  expect(await click(0.5, 0.5)).toMatchObject({ guid: 6, event: { id: 12 } });
  await page.evaluate('window.__setVisibility({ creatures: true, objects: true, paths: true, events: false })');
  await page.waitForTimeout(500);
  expect(await click(0.5, 0.5)).toMatchObject({ guid: 5 });
  expect((await state(page)).errors).toEqual([]);
});

test('dragging the move gizmo moves the selected NPC and drops it on the server\'s floor', async ({ page }) => {
  await openPage(page);
  const SPOT = { x: START.x + 60, y: START.y - 60, z: START.z };
  await page.evaluate(`window.__spawns = { creatures: [
    { guid: 5, entry: 1, name: 'Here', map: 0, x: ${SPOT.x}, y: ${SPOT.y}, z: ${SPOT.z}, orientation: 0, displayId: 0, scale: 4, wander: 0, path: null, pathId: 0, equipment: [0,0,0], own: false, event: null }
  ], objects: [], capped: { creatures: false, objects: false } }`);
  await page.evaluate(`window.__floorZ = ${SPOT.z + 0.25}`);
  await page.evaluate(`window.__open('azeroth', 0, ${JSON.stringify(SPOT)})`);
  await page.waitForFunction('window.__state.ready', null, { timeout: 45000 });
  await page.waitForTimeout(1000);
  const box = (await page.locator('canvas.world3d__canvas').boundingBox())!;
  const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
  await page.mouse.click(cx, cy);
  expect((await state(page)).selected).toMatchObject({ guid: 5 });
  await page.keyboard.press('KeyG');
  // The gizmo's middle handle sits on the NPC's origin, which is the middle of the picture
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 60, cy + 20, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await state(page)).edits.length).toBe(1);
  const [edit] = (await state(page)).edits;
  expect(edit).toMatchObject({ kind: 'place', spawn: { kind: 'creature', guid: 5, own: false }, to: { z: SPOT.z + 0.25, rotation: null } });
  expect(Math.hypot(edit.to.x - SPOT.x, edit.to.y - SPOT.y)).toBeGreaterThan(1);
  // A drag of the gizmo is not an orbit: the camera stayed where it was
  expect((await state(page)).errors).toEqual([]);
});

test('Shift-click on the selected NPC\'s route inserts a point there, and Ctrl+Z takes it back out', async ({ page }) => {
  await openPage(page);
  const SPOT = { x: START.x + 60, y: START.y - 60, z: START.z };
  await page.evaluate(`window.__spawns = { creatures: [
    { guid: 9, entry: 1, name: 'P', map: 0, x: ${SPOT.x - 20}, y: ${SPOT.y + 20}, z: ${SPOT.z}, orientation: 0, displayId: 0, scale: 1, wander: 0, pathId: 77,
      path: [ { x: ${SPOT.x - 6}, y: ${SPOT.y + 6}, z: ${SPOT.z}, carry: { delay: '0' } }, { x: ${SPOT.x + 6}, y: ${SPOT.y - 6}, z: ${SPOT.z}, carry: { delay: '9' } } ],
      equipment: [0,0,0], own: false, event: null }
  ], objects: [], capped: { creatures: false, objects: false } }`);
  await page.evaluate(`window.__open('azeroth', 0, ${JSON.stringify(SPOT)})`);
  await page.waitForFunction('window.__state.ready', null, { timeout: 45000 });
  await page.evaluate(`window.__select({ kind: 'creature', guid: 9 })`);
  await page.waitForTimeout(1500);
  const box = (await page.locator('canvas.world3d__canvas').boundingBox())!;
  await page.keyboard.down('Shift');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await state(page)).edits.length).toBe(1);
  const inserted = (await state(page)).edits[0];
  expect(inserted).toMatchObject({ kind: 'route', pathId: 77, spawn: { guid: 9 } });
  expect(inserted.points.map((p: any) => p.carry ?? null)).toEqual([{ delay: '0' }, null, { delay: '9' }]);
  expect(Math.hypot(inserted.points[1].x - SPOT.x, inserted.points[1].y - SPOT.y)).toBeLessThan(2);
  await page.keyboard.press('Control+KeyZ');
  await expect.poll(async () => (await state(page)).edits.length).toBe(2);
  expect((await state(page)).edits[1].points).toHaveLength(2);
});

test('a route never goes below two points', async ({ page }) => {
  await openPage(page);
  const SPOT = { x: START.x + 60, y: START.y - 60, z: START.z };
  await page.evaluate(`window.__spawns = { creatures: [
    { guid: 9, entry: 1, name: 'P', map: 0, x: ${SPOT.x - 20}, y: ${SPOT.y + 20}, z: ${SPOT.z}, orientation: 0, displayId: 0, scale: 1, wander: 0, pathId: 77,
      path: [ { x: ${SPOT.x}, y: ${SPOT.y}, z: ${SPOT.z} }, { x: ${SPOT.x + 6}, y: ${SPOT.y - 6}, z: ${SPOT.z} } ],
      equipment: [0,0,0], own: false, event: null }
  ], objects: [], capped: { creatures: false, objects: false } }`);
  await page.evaluate(`window.__open('azeroth', 0, ${JSON.stringify(SPOT)})`);
  await page.waitForFunction('window.__state.ready', null, { timeout: 45000 });
  await page.evaluate(`window.__select({ kind: 'creature', guid: 9 })`);
  await page.waitForTimeout(1500);
  const box = (await page.locator('canvas.world3d__canvas').boundingBox())!;
  // The first point is at the middle of the picture
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await state(page)).notices).toContain('A route keeps at least two points.');
  expect((await state(page)).edits).toEqual([]);
});

test('Esc clears the selection and goes no further; with nothing selected it is left to what is round the view', async ({ page }) => {
  await openPage(page);
  const SPOT = { x: START.x + 60, y: START.y - 60, z: START.z };
  await page.evaluate(`window.__spawns = { creatures: [
    { guid: 5, entry: 1, name: 'Here', map: 0, x: ${SPOT.x}, y: ${SPOT.y}, z: ${SPOT.z}, orientation: 0, displayId: 0, scale: 4, wander: 0, path: null, pathId: 0, equipment: [0,0,0], own: false, event: null }
  ], objects: [], capped: { creatures: false, objects: false } }`);
  await page.evaluate(`window.__open('azeroth', 0, ${JSON.stringify(SPOT)})`);
  await page.waitForFunction('window.__state.ready', null, { timeout: 45000 });
  await page.waitForTimeout(1000);
  const box = (await page.locator('canvas.world3d__canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  expect((await state(page)).selected).toMatchObject({ guid: 5 });
  await page.keyboard.press('Escape');
  expect((await state(page)).selected).toBeNull();
  expect((await state(page)).escapes).toBe(0);
  await page.keyboard.press('Escape');
  expect((await state(page)).escapes).toBe(1);
});

test('while placing, a click puts the NPC or object on the ground facing the camera; Esc stops, and a click selects again', async ({ page }) => {
  await openPage(page);
  const SPOT = { x: START.x + 60, y: START.y - 60, z: START.z };
  await page.evaluate(`window.__spawns = { creatures: [
    { guid: 5, entry: 1, name: 'Here', map: 0, x: ${SPOT.x}, y: ${SPOT.y}, z: ${SPOT.z}, orientation: 0, displayId: 0, scale: 4, wander: 0, path: null, pathId: 0, equipment: [0,0,0], own: false, event: null }
  ], objects: [], capped: { creatures: false, objects: false } }`);
  await page.evaluate(`window.__floorZ = ${SPOT.z + 0.25}`);
  await page.evaluate(`window.__open('azeroth', 0, ${JSON.stringify(SPOT)})`);
  await page.waitForFunction('window.__state.ready', null, { timeout: 45000 });
  await page.waitForTimeout(1000);
  const box = (await page.locator('canvas.world3d__canvas').boundingBox())!;
  const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];

  // Placing an NPC: the click on the NPC's own spot places, and selects nothing
  await page.evaluate("window.__placing({ kind: 'creature', entry: 1423 })");
  await page.mouse.click(cx, cy);
  await expect.poll(async () => (await state(page)).placed.length).toBe(1);
  const [first] = (await state(page)).placed;
  expect(first).toMatchObject({ target: { kind: 'creature', entry: 1423 }, at: { z: SPOT.z + 0.25, rotation: null } });
  expect((await state(page)).selected).toBeNull();
  // Faces the camera: the angle from where it stands to where the camera is
  const camera = (await page.evaluate('window.__camera()')) as { position: { x: number; y: number } };
  const toCamera = Math.atan2(camera.position.y - first!.at.y, camera.position.x - first!.at.x);
  expect(Math.cos(first!.at.orientation - toCamera)).toBeCloseTo(1, 3);

  // Placing an object keeps the whole turn about Z, and each click places another
  await page.evaluate("window.__placing({ kind: 'object', entry: 143981 })");
  await page.mouse.click(cx, cy);
  await expect.poll(async () => (await state(page)).placed.length).toBe(2);
  const second = (await state(page)).placed[1]!;
  expect(second.target).toEqual({ kind: 'object', entry: 143981 });
  expect(second.at.rotation).toHaveLength(4);

  // Esc stops placing and goes no further; the next click selects the NPC again
  await page.keyboard.press('Escape');
  expect((await state(page)).placeEnds).toBe(1);
  expect((await state(page)).escapes).toBe(0);
  await page.mouse.click(cx, cy);
  expect((await state(page)).selected).toMatchObject({ guid: 5 });
  expect((await state(page)).placed).toHaveLength(2);
  expect((await state(page)).errors).toEqual([]);
});

test('draws the patrol route of the selected NPC as a line over the ground', async ({ page }) => {
  await openPage(page);
  // Away from the house at START. The route runs through the camera's target (it draws over the terrain)
  const SPOT = { x: START.x + 60, y: START.y - 60, z: START.z };
  // A route crossing the middle of the picture, with no model for its NPC (display 0, a marker off to the side)
  await page.evaluate(`window.__spawns = { creatures: [
    { guid: 9, entry: 1, name: 'P', map: 0, x: ${SPOT.x - 20}, y: ${SPOT.y + 20}, z: ${SPOT.z}, orientation: 0, displayId: 0, scale: 1, wander: 0,
      path: [ { x: ${SPOT.x - 6}, y: ${SPOT.y + 6}, z: ${SPOT.z} }, { x: ${SPOT.x + 6}, y: ${SPOT.y - 6}, z: ${SPOT.z} } ],
      equipment: [0,0,0], own: false }
  ], objects: [], capped: { creatures: false, objects: false } }`);
  await page.evaluate(`window.__open('azeroth', 0, ${JSON.stringify(SPOT)})`);
  await page.waitForFunction('window.__state.ready', null, { timeout: 45000 });
  // Routes are drawn only for the selected NPC
  await page.evaluate(`window.__select({ kind: 'creature', guid: 9 })`);
  await page.waitForTimeout(1500);
  const picture = await page.locator('canvas.world3d__canvas').screenshot();
  if (process.env['WORLD3D_SHOT']) writeFileSync(process.env['WORLD3D_SHOT'].replace(/.png$/, '-route.png'), picture);
  // The route's yellow (0xf0d060) runs through the middle: the yellowest pixel of the 9 x 9 there (a line is a pixel wide)
  let best = [0, 0, 0];
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const p = (await page.evaluate(`window.__pixel(${JSON.stringify(picture.toString('base64'))}, ${0.5 + dx / 960}, ${0.5 + dy / 600})`)) as number[];
      if (p[0]! + p[1]! - 2 * p[2]! > best[0]! + best[1]! - 2 * best[2]!) best = p;
    }
  }
  const [r, g, b] = best;
  expect(r!).toBeGreaterThan(200);
  expect(g!).toBeGreaterThan(170);
  expect(b!).toBeLessThan(140);
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
