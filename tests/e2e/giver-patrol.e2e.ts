import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mysqlUrl } from '../helpers/env';

const DATA_DIR = process.env.ACQC_WORLD_DB_DBC_DIR ? join(process.env.ACQC_WORLD_DB_DBC_DIR, '..') : 'E:\\Repositories\\azerothcore-wotlk-coa\\data';
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
  const u = new URL(mysqlUrl());
  const outDir = mkdtempSync(join(tmpdir(), 'acqc-out-'));
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...withoutConnectionEnv(process.env), ACQC_USER_DATA: mkdtempSync(join(tmpdir(), 'acqc-ud-')), ACQC_OUTPUT_DIR: outDir, ACQC_ENV_FILE: 'none' },
  });
  running = app;
  const page = await app.firstWindow();
  await page.getByLabel('Host').fill(u.hostname);
  await page.getByLabel('Port').fill(u.port || '3306');
  await page.getByLabel('User').fill(decodeURIComponent(u.username));
  await page.getByLabel('Database').fill(u.pathname.slice(1));
  await page.getByLabel('Password').fill(decodeURIComponent(u.password));
  await page.getByLabel('Server data folder (optional)').fill(DATA_DIR);
  await page.getByRole('button', { name: 'Save and connect' }).click();

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
  await card.getByRole('button', { name: 'Place on map' }).click();

  const map = page.getByRole('dialog', { name: 'Quest map' });
  await expect(map.getByText('Click where Patrol Hela should stand.')).toBeVisible();
  // Northshire: pick the map, then click the middle of the canvas.
  await map.getByRole('combobox', { name: 'Map' }).selectOption({ label: 'Eastern Kingdoms' });
  await map.getByRole('combobox', { name: 'Jump to' }).fill('Marshal McBride');
  await map.getByRole('option', { name: /Marshal McBride/ }).first().click();
  const canvas = map.locator('.quest-map__canvas');
  const box = (await canvas.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.click(cx, cy);
  await expect(map.getByText('Placed. Drag to adjust, or draw its patrol.')).toBeVisible();
  await map.getByRole('button', { name: 'Draw patrol' }).click();
  await expect(map.getByRole('heading', { name: 'Patrol: Patrol Hela' })).toBeVisible();
  // Above and left of the spawn: its label runs off to the right and takes clicks of its own.
  await page.mouse.click(cx, cy - 80);
  await expect(map.getByRole('button', { name: 'Point 1', exact: true })).toBeVisible();
  await page.mouse.click(cx - 80, cy - 80);
  await expect(map.getByRole('button', { name: 'Point 2', exact: true })).toBeVisible();
  await page.mouse.click(cx - 80, cy);
  await expect(map.getByRole('button', { name: 'Point 3', exact: true })).toBeVisible();

  await map.locator('.quest-map__marker[title="Patrol Hela · patrol point 2"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Wait here…' }).click();
  await map.getByLabel('Wait (seconds)').fill('8');
  await map.locator('.quest-map__marker[title="Patrol Hela · patrol point 2"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Say something…' }).click();
  await map.getByRole('group', { name: 'Says' }).getByLabel('Line 1').fill('All quiet here.');
  await map.locator('.quest-map__marker[title="Patrol Hela · patrol point 2"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Hold a pose while waiting…' }).click();
  await page.screenshot({ path: 'test-results/giver-patrol.png' });
  await map.getByRole('button', { name: 'Done' }).click();
  await map.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog', { name: 'Quest Giver' })).toBeVisible();
  await page.keyboard.press('Escape');

  // The same NPC editor opens from NPCs & objects, with the patrol on its Placement tab.
  await page.getByRole('list', { name: 'Modules' }).getByRole('button', { name: /^NPCs & objects/ }).click();
  const entities = page.getByRole('dialog', { name: 'NPCs & objects' });
  await entities.getByRole('listitem', { name: 'Patrol Hela' }).getByRole('button', { name: 'Edit' }).click();
  const editor = page.getByRole('dialog', { name: 'NPC: Patrol Hela' });
  await editor.getByRole('tab', { name: 'Placement' }).click();
  await expect(editor.getByText('Walks a patrol of 3 points.')).toBeVisible();
  await editor.getByRole('button', { name: 'Done' }).click();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Export patch' }).click();
  await expect(page.getByText(/\.sql$/)).toBeVisible();
  const sql = readFileSync(join(outDir, readdirSync(outDir)[0]!), 'utf8');
  expect(sql).toContain('Patrol Hela');
  expect(sql).toMatch(/INSERT INTO `creature_addon`/);
  // Three points, then back where it stands.
  expect(sql.match(/INSERT INTO `waypoint_data`/g)).toHaveLength(4);
  expect(sql).toMatch(/INSERT INTO `waypoint_data` .*, 8000,/);
  expect(sql).toContain('All quiet here.');
  expect(sql).toMatch(/INSERT INTO `smart_scripts` .*VALUES \(\d+, 0, 0, 0, 34, /);
});
