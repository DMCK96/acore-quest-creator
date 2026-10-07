import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clientDir, mysqlUrl, serverDataDir } from '../helpers/env';
import { exportProjectPatch } from './project-patch';

// The server data and game client folders come from the same .env settings the app uses.
const DATA_DIR = serverDataDir();
const CLIENT_DIR = clientDir();
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

test('a new quest giver is made, placed and given a patrol with a line to say, all from the giver card', async () => {
  test.setTimeout(240_000);
  const u = new URL(mysqlUrl());
  const outDir = mkdtempSync(join(tmpdir(), 'acqc-out-'));
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...withoutConnectionEnv(process.env), ACQC_USER_DATA: mkdtempSync(join(tmpdir(), 'acqc-ud-')), ACQC_OUTPUT_DIR: outDir, ACQC_ENV_FILE: 'none' },
  });
  running = app;
  const page = await app.firstWindow();
  await page.getByLabel('Host').fill(u.hostname);
  await page.getByLabel('Port', { exact: true }).fill(u.port || '3306');
  await page.getByLabel('User').fill(decodeURIComponent(u.username));
  await page.getByLabel('Database').fill(u.pathname.slice(1));
  await page.getByLabel('Password').fill(decodeURIComponent(u.password));
  await page.getByLabel('Server data folder (optional)').fill(DATA_DIR);
  await page.getByLabel('Game client folder (optional)').fill(CLIENT_DIR);
  await page.getByRole('button', { name: 'Save and connect' }).click();
  // The World is the home screen. Open ground first: the camera closes in on Marshal McBride in Northshire.
  await page.getByRole('button', { name: 'Just look around' }).click({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Find…' }).click();
  const find = page.getByRole('dialog', { name: 'Find an NPC or object' });
  await find.getByRole('searchbox', { name: 'Find by name or ID' }).fill('Marshal McBride');
  await find.locator('.place-dialog__hit').first().click({ timeout: 30_000 });
  await find.getByRole('button', { name: /^Go to spawn/ }).first().click({ timeout: 30_000 });
  await expect(page.getByRole('region', { name: 'Selected spawn' })).toBeVisible({ timeout: 30_000 });
  await page.locator('.world3d__stage canvas').focus();
  await page.keyboard.press('Escape');
  // The quest graph is in the Quests dock under the World.
  await page.getByRole('button', { name: 'Quests', exact: true }).click();

  await page.getByRole('button', { name: 'New quest', exact: true }).click();
  await page.getByLabel('Quest title').fill('Patrol test');
  await page.getByRole('list', { name: 'Modules' }).getByRole('button', { name: /^Quest Giver/ }).click();
  const giver = page.getByRole('dialog', { name: 'Quest Giver' });
  await giver.getByRole('button', { name: 'Add quest giver' }).click();
  await giver.getByRole('button', { name: 'New NPC for starts at 1' }).click();
  const npc = page.getByRole('dialog', { name: 'New NPC' });
  await npc.getByLabel('Name', { exact: true }).fill('Patrol Hela');
  await npc.getByRole('tab', { name: 'Look & gear' }).click();
  await npc.getByRole('button', { name: 'Other ways' }).click();
  await npc.getByLabel('Display ID').fill('1234');
  await npc.getByRole('button', { name: 'Done' }).click();
  const card = giver.getByRole('region', { name: 'Starts at 1' });
  await expect(card.getByText('Patrol Hela')).toBeVisible();
  // Place in world: the editor steps aside, and a click on the ground puts the NPC there
  const stage = page.locator('.world3d__stage canvas');
  const box = (await stage.boundingBox())!;
  const at = (fx: number, fy: number) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });
  await card.getByRole('button', { name: 'Place in world' }).click();
  await expect(page.getByText(/^Placing Patrol Hela/)).toBeVisible();
  // A click before the ground is drawn lands on nothing; the next one, once it is, places her
  await expect(async () => {
    await page.mouse.click(at(0.5, 0.6).x, at(0.5, 0.6).y);
    await expect(page.getByRole('region', { name: 'Selected spawn' }).getByText('Patrol Hela')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 90_000 });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  // Draw patrol: the World goes to the spawn, each click adds a point and Enter finishes
  await card.getByRole('button', { name: 'Draw patrol' }).click();
  await expect(page.getByText(/^Drawing Patrol Hela’s patrol/)).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500); // the camera's move to the spawn
  // Clear of the NPC and its handles in the middle
  const points = [at(0.3, 0.8), at(0.2, 0.9), at(0.7, 0.85)];
  for (const p of points) {
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(500);
  }
  await page.keyboard.press('Enter');
  // The editor comes back, and the patrol is one step of the history
  await expect(giver).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Undo: Patrol of Patrol Hela (Ctrl+Z)' })).toBeVisible();
  // Point settings on the second point drawn: an eight-second wait and a line to say
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Edit quest' })).toHaveCount(0);
  await page.mouse.click(points[1]!.x, points[1]!.y, { button: 'right' });
  await page.getByRole('menu', { name: 'World actions' }).getByRole('menuitem', { name: 'Point settings…' }).click();
  const point = page.getByRole('dialog', { name: /^Point \d+$/ });
  await point.getByLabel('Wait (seconds)').fill('8');
  await point.getByLabel('Actions').selectOption('say');
  await point.getByLabel('Line 1').fill('All quiet here.');
  await page.screenshot({ path: 'test-results/giver-patrol.png' });
  await point.getByRole('button', { name: 'Apply' }).click();
  await expect(point).toHaveCount(0);
  await page.getByRole('complementary', { name: 'Quest preview' }).getByRole('button', { name: 'Edit quest' }).click();

  // The same NPC editor opens from NPCs, objects & items, with the patrol on its Placement tab.
  await page.getByRole('list', { name: 'Modules' }).getByRole('button', { name: /^NPCs, objects & items/ }).click();
  const entities = page.getByRole('dialog', { name: 'NPCs, objects & items' });
  await entities.getByRole('listitem', { name: 'Patrol Hela' }).getByRole('button', { name: 'Edit' }).click();
  const editor = page.getByRole('dialog', { name: 'NPC: Patrol Hela' });
  await editor.getByRole('tab', { name: 'Placement' }).click();
  // The spawn starts the route, then the three points drawn
  await expect(editor.getByText('Walks a patrol of 4 points.')).toBeVisible();
  await editor.getByRole('button', { name: 'Done' }).click();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Export patch' }).click();
  await expect(page.getByText(/\.sql$/)).toBeVisible();
  // The NPC, its patrol and its lines are the project's: they are in the project patch
  const sql = await exportProjectPatch(page);
  expect(sql).toContain('Patrol Hela');
  expect(sql).toMatch(/INSERT INTO `creature_addon`/);
  // Four points, then back where it stands.
  expect(sql.match(/INSERT INTO `waypoint_data`/g)).toHaveLength(5);
  expect(sql).toMatch(/INSERT INTO `waypoint_data` .*, 8000,/);
  expect(sql).toContain('All quiet here.');
  expect(sql).toMatch(/INSERT INTO `smart_scripts` .*VALUES \(\d+, 0, 0, 0, 34, /);
});
