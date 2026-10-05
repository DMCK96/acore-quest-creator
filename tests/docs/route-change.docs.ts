/**
 * The before and after of a route change for the World guide: `npm run docs:screenshots`.
 *
 * The Stormwind Guard that walks from Goldshire to Northshire Valley (spawn 80263, path 802630)
 * walks the stock route, which cuts across the grass beside the road. The fixture project
 * (`fixtures/goldshire.awe`) moves that stretch onto the road. Both images are taken from the same
 * camera: high over Goldshire, looking up the road to Northshire, with trees hidden so the route shows.
 */
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { worldDbFromEnv } from './world-env';

const ROOT = resolve(process.cwd());
const OUT_DIR = join(ROOT, 'site/src/assets/screenshots');
const FIXTURE = join(ROOT, 'tests/docs/fixtures/goldshire.awe');
const WIDTH = 1440;
const HEIGHT = 900;
const GUARD = { entry: 1423, spawn: 80263 };

const world = worldDbFromEnv(readFileSync(join(ROOT, '.env'), 'utf8'));
if (!world.clientDir) throw new Error('Set ACQC_WORLD_DB_CLIENT_DIR in .env: the World needs the game client folder');

async function shot(page: Page, name: string): Promise<void> {
  const png = await page.screenshot({ animations: 'disabled' });
  expect(png.readUInt32BE(16), `${name}.png width`).toBe(WIDTH);
  expect(png.readUInt32BE(20), `${name}.png height`).toBe(HEIGHT);
  writeFileSync(join(OUT_DIR, `${name}.png`), png);
}

async function worldSettled(page: Page): Promise<void> {
  for (let i = 0; i < 90; i++) {
    const busy = (await page.getByText('Loading the world…').count()) + (await page.getByText(/Loading NPCs and objects/).count());
    if (busy === 0) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(4000);
}

/**
 * Drags with a mouse button in small steps, as a hand would, starting `below` pixels under the middle
 * of the view: the selected guard's gizmo sits in the middle, and a drag that starts on it moves him.
 */
async function drag(page: Page, button: 'left' | 'middle', dx: number, dy: number, below = 0): Promise<void> {
  const box = (await page.locator('.world3d__stage canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2 + below;
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button });
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(cx + (dx * i) / 20, cy + (dy * i) / 20);
    await page.waitForTimeout(20);
  }
  await page.mouse.up({ button });
  await page.waitForTimeout(300);
}

/**
 * Goes to the guard (selecting it, so its route is drawn), then frames the route: an orbit round
 * the guard turns the view to face Northshire and tilts it near top-down, the wheel backs off, and a
 * pan brings the stretch the project changes into the middle.
 */
async function goToGuard(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Find…' }).click();
  const find = page.getByRole('dialog', { name: 'Find an NPC or object' });
  await find.getByRole('searchbox', { name: 'Find by name or ID' }).fill(String(GUARD.entry));
  await find.locator('.place-dialog__hit').first().click({ timeout: 30000 });
  await find.getByRole('button', { name: `Go to spawn ${GUARD.spawn}` }).click({ timeout: 30000 });
  await expect(page.getByRole('region', { name: 'Selected spawn' })).toBeVisible({ timeout: 30000 });
  await worldSettled(page);
}

async function frameRoute(page: Page): Promise<void> {
  await goToGuard(page);
  await drag(page, 'left', 390, 40, 200);
  const box = (await page.locator('.world3d__stage canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 11; i++) {
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(150);
  }
  await drag(page, 'middle', 0, 250);
  await worldSettled(page);
}

test.describe.serial('route change screenshots', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    app = await electron.launch({
      args: ['out/main/index.js'],
      cwd: ROOT,
      env: {
        ...(Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined))),
        ACQC_USER_DATA: mkdtempSync(join(tmpdir(), 'acqc-docs-ud-')),
        ACQC_OUTPUT_DIR: mkdtempSync(join(tmpdir(), 'acqc-docs-out-')),
      },
    });
    page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]!.setContentSize(size.w, size.h);
    }, { w: WIDTH, h: HEIGHT });
    await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  });

  test.afterAll(async () => {
    if (!app) return;
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as never;
    });
    await app.close();
  });

  test('route-before', async () => {
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.getByRole('button', { name: 'Just look around' }).click({ timeout: 30000 });
    await page.getByRole('group', { name: 'Layers' }).getByLabel('Trees & props').uncheck();
    await frameRoute(page);
    await shot(page, 'route-before');
  });

  test('route-after', async () => {
    // A copy, so the run never writes to the fixture
    const copy = join(mkdtempSync(join(tmpdir(), 'acqc-docs-proj-')), 'Goldshire.awe');
    copyFileSync(FIXTURE, copy);
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as never;
    }, copy);
    await page.getByRole('button', { name: 'Project', exact: true }).click();
    await page.getByRole('dialog', { name: 'Project' }).getByRole('button', { name: 'Open…' }).click();
    await expect(page.getByRole('heading', { name: 'Goldshire', level: 1 })).toBeVisible({ timeout: 30000 });
    const welcome = page.getByRole('button', { name: 'Just look around' });
    if (await welcome.isVisible().catch(() => false)) await welcome.click();
    // The camera and the selected guard stay as they were: only the route changes
    await worldSettled(page);
    // Only the fixture's route edit: framing must not have moved anything
    await expect(page.getByRole('region', { name: 'Selected spawn' }).getByText('Z 56.02')).toBeVisible();
    await shot(page, 'route-after');
  });
});
