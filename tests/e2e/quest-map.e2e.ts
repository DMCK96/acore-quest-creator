import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mysqlUrl } from '../helpers/env';

const DATA_DIR = process.env.ACQC_WORLD_DB_DBC_DIR ? join(process.env.ACQC_WORLD_DB_DBC_DIR, '..') : 'E:\\Repositories\\azerothcore-wotlk-coa\\data';
const CLIENT_DIR = process.env.ACQC_TEST_CLIENT_DIR ?? 'E:\\Games\\World of Warcraft - Ascension';
const withoutConnectionEnv = (env: NodeJS.ProcessEnv): Record<string, string> =>
  Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => e[1] !== undefined && !/^ACQC_(WORLD|DEV)_DB_/.test(e[0])));

let running: ElectronApplication | undefined;
test.afterEach(async () => {
  if (!running) return;
  await running.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as never;
  });
  await running.close();
  running = undefined;
});

test('a new NPC spawn is shown on the quest map and moved by dragging', async () => {
  const u = new URL(mysqlUrl());
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...withoutConnectionEnv(process.env), ACQC_USER_DATA: mkdtempSync(join(tmpdir(), 'acqc-ud-')), ACQC_OUTPUT_DIR: mkdtempSync(join(tmpdir(), 'acqc-out-')), ACQC_ENV_FILE: 'none' },
  });
  running = app;
  const page = await app.firstWindow();
  await page.getByLabel('Host').fill(u.hostname);
  await page.getByLabel('Port').fill(u.port || '3306');
  await page.getByLabel('User').fill(decodeURIComponent(u.username));
  await page.getByLabel('Database').fill(u.pathname.slice(1));
  await page.getByLabel('Password').fill(decodeURIComponent(u.password));
  await page.getByLabel('Server data folder (optional)').fill(DATA_DIR);
  await page.getByLabel('Game client folder (optional)').fill(CLIENT_DIR);
  await page.getByRole('button', { name: 'Save and connect' }).click();

  await page.getByRole('button', { name: 'New quest', exact: true }).click();
  await page.getByLabel('Quest title').fill('Map test');
  await page.getByRole('button', { name: 'Add module' }).click();
  await page.getByRole('menuitem', { name: /^NPCs & objects/ }).click();
  const panel = page.getByRole('dialog', { name: 'NPCs & objects' });
  await panel.getByRole('button', { name: 'Add NPC' }).click();
  const card = page.getByRole('dialog', { name: 'New NPC' });
  await card.getByLabel('Name', { exact: true }).fill('Map Hela');
  await card.getByRole('tab', { name: 'Placement' }).click();
  await card.getByRole('button', { name: 'Add spawn' }).click();
  await card.getByLabel('Paste .gps output').fill('Map: 0 X: -8902.59 Y: -162.606 Z: 82.02 Orientation: 1');
  await card.getByRole('button', { name: 'Done' }).click();
  await page.keyboard.press('Escape');

  const tileLoaded = page.waitForResponse((r) => r.url().startsWith('acqc-map://tile/0/6/') && r.status() === 200);
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  const map = page.getByRole('dialog', { name: 'Quest map' });
  await expect(map).toBeVisible();
  await tileLoaded;
  const marker = map.locator('.quest-map__marker', { hasText: 'Map Hela' });
  await expect(marker).toBeVisible();
  const boxBefore = (await marker.boundingBox())!;
  await page.mouse.move(boxBefore.x + boxBefore.width / 2, boxBefore.y + boxBefore.height / 2);
  await page.mouse.down();
  await page.mouse.move(boxBefore.x + 60, boxBefore.y + 40, { steps: 8 });
  await page.mouse.up();
  await expect(map.getByRole('button', { name: /^Floor / }).first()).toBeVisible();
  // Existing spawns around Northshire show as canvas dots at the opening zoom (7).
  const canvas = map.locator('.quest-map__canvas');
  await expect.poll(async () => Number(await canvas.getAttribute('data-dot-count'))).toBeGreaterThan(0);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-results/quest-map-z7.png' });

  // Zoomed out, the painted art shows and the dots go.
  const zoomOut = map.getByRole('button', { name: 'Zoom out' });
  const zoomIn = map.getByRole('button', { name: 'Zoom in' });
  const artLoaded = page.waitForResponse((r) => r.url().startsWith('acqc-map://tile/0/4/') && r.status() === 200);
  for (let i = 0; i < 3; i++) {
    await zoomOut.click();
    await page.waitForTimeout(350);
  }
  await artLoaded;
  await expect(map.getByText('Zoom in to see existing spawns.')).toBeVisible();
  await expect(canvas).toHaveAttribute('data-dot-count', '0');
  await page.waitForTimeout(8000);
  await page.screenshot({ path: 'test-results/quest-map-z4.png' });

  // All the way in: zoom 11.
  for (let i = 0; i < 7; i++) {
    await zoomIn.click();
    await page.waitForTimeout(350);
  }
  await expect(zoomIn).toHaveClass(/leaflet-disabled/);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'test-results/quest-map-z11.png' });
  await map.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Changes' }).click();
  await expect(page.getByRole('dialog', { name: 'Changes' }).getByRole('heading', { name: 'creature', exact: true })).toBeVisible();
});
