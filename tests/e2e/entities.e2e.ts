import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mysqlUrl } from '../helpers/env';

const withoutConnectionEnv = (env: NodeJS.ProcessEnv): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).filter(
      (e): e is [string, string] => e[1] !== undefined && !/^ACQC_(WORLD|DEV)_DB_/.test(e[0]),
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

test('a new NPC is created, placed, made the quest giver and exported with the quest', async () => {
  const u = new URL(mysqlUrl());
  const outDir = mkdtempSync(join(tmpdir(), 'acqc-out-'));
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: {
      ...withoutConnectionEnv(process.env),
      ACQC_USER_DATA: mkdtempSync(join(tmpdir(), 'acqc-ud-')),
      ACQC_OUTPUT_DIR: outDir,
      ACQC_ENV_FILE: 'none',
    },
  });
  running = app;
  const page = await app.firstWindow();

  await page.getByLabel('Host').fill(u.hostname);
  await page.getByLabel('Port', { exact: true }).fill(u.port || '3306');
  await page.getByLabel('User').fill(decodeURIComponent(u.username));
  await page.getByLabel('Database').fill(u.pathname.slice(1));
  await page.getByLabel('Password').fill(decodeURIComponent(u.password));
  await page.getByRole('button', { name: 'Save and connect' }).click();
  // The world is the home screen; the quest graph is in the Quests dock under it.
  await page.getByRole('button', { name: 'Quests', exact: true }).click();

  await page.getByRole('button', { name: 'New quest', exact: true }).click();
  await page.getByLabel('Quest title').fill('Meet Hela');

  await page.getByRole('button', { name: 'Add module' }).click();
  await page.getByRole('menuitem', { name: /^NPCs, objects & items/ }).click();
  const panel = page.getByRole('dialog', { name: 'NPCs, objects & items' });
  await panel.getByRole('button', { name: 'Add NPC' }).click();
  const card = page.getByRole('dialog', { name: 'New NPC' });
  await card.getByLabel('Name', { exact: true }).fill('Scout Hela');
  await card.getByRole('tab', { name: 'Look & gear' }).click();
  await card.getByRole('button', { name: 'Other ways' }).click();
  await card.getByLabel('Display ID').fill('1234');
  await card.getByRole('tab', { name: 'Placement' }).click();
  await card.getByRole('button', { name: 'Add spawn' }).click();
  await card.getByLabel('Paste .gps output').fill('Map: 0 X: -8913.2 Y: -136.5 Z: 80.5 Orientation: 1');
  await expect(card.getByLabel('X', { exact: true })).toHaveValue('-8913.2');
  await page.screenshot({ path: 'test-results/entities-module.png' });
  await card.getByRole('button', { name: 'Done' }).click();
  await expect(panel.getByRole('listitem', { name: 'Scout Hela' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('list', { name: 'Modules' }).getByRole('button', { name: /^Quest Giver/ }).click();
  const giver = page.getByRole('dialog', { name: 'Quest Giver' });
  await giver.getByRole('button', { name: 'Add quest giver' }).click();
  await giver.getByRole('combobox', { name: 'Starts at 1' }).fill('Scout Hela');
  await giver.getByRole('option', { name: /Scout Hela · new · #\d+$/ }).click();
  await page.keyboard.press('Escape');
  // The quest panel lists the entities the quest uses first
  await page.getByRole('list', { name: 'Modules' }).getByRole('button', { name: /^NPCs, objects & items/ }).click();
  const used = page.getByRole('dialog', { name: 'NPCs, objects & items' });
  await expect(used.getByRole('region', { name: 'Used by this quest' }).getByRole('listitem', { name: 'Scout Hela' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Changes' }).click();
  const changes = page.getByRole('dialog', { name: 'Changes' });
  // The quest's own rows: the NPC's template and spawn are the project patch's
  await expect(changes.getByRole('heading', { name: 'creature_queststarter', exact: true })).toBeVisible();
  await expect(changes.getByRole('heading', { name: 'creature_template', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Export patch' }).click();
  await expect(page.getByText(/\.sql$/)).toBeVisible();
  const files = readdirSync(outDir);
  expect(files).toHaveLength(1);
  const sql = readFileSync(join(outDir, files[0]!), 'utf8');
  expect(sql).toMatch(/INSERT INTO `creature_queststarter`/);
  // The NPC itself is the project's: it goes in the project patch, which the quest's export offers
  expect(sql).not.toContain('Scout Hela');
  await expect(page.getByText('This quest uses 1 new NPCs, objects or items from the project patch.')).toBeVisible();
  await page.getByRole('button', { name: 'Export project patch' }).click();
  const projectPath = (await page.getByText(/^Project patch written to/).locator('code').textContent())!;
  const project = readFileSync(projectPath, 'utf8');
  expect(project).toContain('Scout Hela');
  expect(project).toMatch(/INSERT INTO `creature` .*'AQC npc\d+/);
});
