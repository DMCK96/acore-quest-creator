import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { clientDir, mysqlUrl, serverDataDir } from '../helpers/env';

/**
 * The project's NPCs, objects and items: a version 3 project opens with its quest's NPC moved into the
 * project; an NPC made from the World view's right-click menu is undone and done again; and the
 * project patch carries both.
 */
const FIXTURE = resolve('tests/e2e/fixtures/v3-project.aqc');
const DATA_DIR = serverDataDir();
const CLIENT_DIR = clientDir();
const withoutConnectionEnv = (env: NodeJS.ProcessEnv): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).filter(
      (e): e is [string, string] => e[1] !== undefined && !/^ACQC_(WORLD|DEV)_DB_/.test(e[0]) && e[0] !== 'ELECTRON_RUN_AS_NODE',
    ),
  );

let running: ElectronApplication | undefined;
test.afterEach(async () => {
  if (!running) return;
  // The project has unsaved edits, so quitting asks to save it; answer "Don't Save" so nothing hangs.
  await running.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as never;
  });
  await running.close();
  running = undefined;
});

const changesButton = (page: Page) => page.getByRole('button', { name: /^Project changes \(\d+\)$/ });
const undoButton = (page: Page) => page.getByRole('button', { name: /^Undo/ });

test('a version 3 project, an NPC made in the World and undone, and the project patch', async () => {
  test.setTimeout(180_000);
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
  await expect(page.getByRole('tab', { name: 'Quests' })).toBeVisible({ timeout: 30_000 });

  // 1. The version 3 project: its quest's NPC is now the project's, used by the quest
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as never;
  }, FIXTURE);
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByRole('dialog', { name: 'Project' }).getByRole('button', { name: 'Open…' }).click();
  await expect(page.getByRole('banner').getByRole('heading', { level: 1 })).toHaveText('Fixture v3');

  await page.getByRole('tab', { name: 'Quests' }).click();
  // The fixture's card sits at the canvas origin, under the quest tools: a double-click opens it there too
  await page.getByTestId('quest-node').filter({ hasText: 'Fixture Wolves' }).dispatchEvent('dblclick');
  await page.getByRole('list', { name: 'Modules' }).getByRole('button', { name: /^NPCs, objects & items/ }).click();
  await expect(page.getByRole('dialog', { name: 'NPCs, objects & items' }).getByRole('listitem', { name: 'Fixture Hela' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '← Back to chain' }).click();

  await page.getByRole('tab', { name: 'World' }).click();
  // A project's first visit to the World greets it; Esc leaves the greeting
  const welcome = page.getByRole('dialog', { name: 'Welcome' });
  await expect(welcome).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(welcome).toHaveCount(0);
  await expect(changesButton(page)).toHaveText('Project changes (1)', { timeout: 60_000 });
  await changesButton(page).click();
  const changes = page.getByRole('dialog', { name: 'Project changes' });
  await expect(changes.getByRole('region', { name: 'NPCs, objects & items' }).getByRole('listitem', { name: 'Fixture Hela' })).toContainText('NPC 12000001 · New');
  // The fixture's quest never names Hela as a giver, ender or objective, so no quest uses her
  await expect(changes.getByRole('listitem', { name: 'Fixture Hela' })).not.toContainText('used by');
  // Go to takes the camera to its spawn, near Northshire
  await changes.getByRole('listitem', { name: 'Fixture Hela' }).getByRole('button', { name: 'Go to' }).click();
  await expect(changes).toHaveCount(0);

  // 2. New NPC here, on bare ground: with buildings, props, NPCs and objects hidden the click lands on
  // the terrain, once it is drawn (the menu's New NPC here… waits for a ground point)
  for (const layer of ['Buildings', 'Trees & props', 'NPCs', 'Objects']) await page.getByRole('group', { name: 'Layers' }).getByLabel(layer, { exact: true }).uncheck();
  const box = (await page.locator('.world3d__stage canvas').boundingBox())!;
  const newHere = page.getByRole('menuitem', { name: /^New NPC here…/ });
  await expect(async () => {
    await page.keyboard.press('Escape');
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.75, { button: 'right' });
    await expect(newHere).not.toHaveAttribute('aria-disabled', 'true', { timeout: 1000 });
  }).toPass({ timeout: 90_000 });
  await newHere.click();
  const editor = page.getByRole('dialog', { name: /NPC/ }).last();
  await editor.getByLabel('Name', { exact: true }).fill('E2E Scout');
  await editor.getByLabel('Min level').fill('12');
  await editor.getByLabel('Max level').fill('12');
  await editor.getByLabel('Faction ID').fill('14');
  // A new NPC needs a model before the project patch can be written
  await editor.getByRole('tab', { name: 'Look & gear' }).click();
  await editor.getByRole('button', { name: 'Other ways' }).click();
  await editor.getByLabel('Display ID').fill('1234');
  await editor.getByRole('button', { name: 'Done' }).click();
  await expect(changesButton(page)).toHaveText('Project changes (2)');
  await page.screenshot({ path: 'test-results/project-entities-world.png' });

  // 3. Undone back past "New NPC" (Ctrl+Z, then the History list for the rest, since several steps
  // share a name), then done again
  const history = page.getByRole('menu', { name: 'History' });
  await page.locator('.world3d__stage canvas').focus();
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('button', { name: /^Redo: / })).toBeVisible();
  await page.getByRole('button', { name: 'History' }).click();
  const steps = history.getByRole('menuitem');
  const labels = await steps.allTextContents();
  const created = labels.findIndex((l) => /New NPC$/.test(l));
  expect(created).toBeGreaterThanOrEqual(0);
  await steps.nth(created + 1).click();
  await expect(changesButton(page)).toHaveText('Project changes (1)');
  await page.locator('.world3d__stage canvas').focus();
  await page.keyboard.press('Control+y');
  await expect(changesButton(page)).toHaveText('Project changes (2)');
  await page.getByRole('button', { name: 'History' }).click();
  await steps.first().click();
  await expect(page.getByRole('button', { name: /^Redo: / })).toHaveCount(0);

  // 4. The project patch: the fixture's NPC and the new one, each tagged by NPC
  await changesButton(page).click();
  const again = page.getByRole('dialog', { name: 'Project changes' });
  await expect(again.getByRole('listitem', { name: 'E2E Scout' })).toBeVisible();
  await again.getByRole('button', { name: 'Export project patch' }).click();
  const written = (await again.locator('.world-changes__exported p').nth(1).textContent())!.trim();
  const sql = readFileSync(written, 'utf8');
  expect(sql).toContain("'E2E Scout'");
  expect(sql).toContain("'Fixture Hela'");
  expect(sql).toMatch(/INSERT INTO `creature_template` .*12000001/);
  expect(sql).toMatch(/'AQC npc\d+/);
});
