import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mysqlUrl } from '../helpers/env';

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

test('a new NPC gets a two-phase fight that exports as SmartAI', async () => {
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
  await page.getByRole('button', { name: 'Save and connect' }).click();

  await page.getByRole('button', { name: 'New quest', exact: true }).click();
  await page.getByLabel('Quest title').fill('Defeat Hela');
  await page.getByRole('button', { name: 'Add module' }).click();
  await page.getByRole('menuitem', { name: /^NPCs & objects/ }).click();
  const panel = page.getByRole('dialog', { name: 'NPCs & objects' });
  await panel.getByRole('button', { name: 'Add NPC' }).click();
  const card = page.getByRole('dialog', { name: 'New NPC' });
  await card.getByLabel('Name', { exact: true }).fill('Hela');
  await card.getByRole('tab', { name: 'Look & gear' }).click();
  await card.getByRole('button', { name: 'Other ways' }).click();
  await card.getByLabel('Display ID').fill('1234');
  await card.getByRole('tab', { name: 'Placement' }).click();
  await card.getByRole('button', { name: 'Add spawn' }).click();
  await card.getByLabel('Paste .gps output').fill('Map: 0 X: -8913.2 Y: -136.5 Z: 80.5 Orientation: 1');
  await card.getByRole('tab', { name: 'Fight' }).click();

  const fight = card.getByRole('region', { name: 'Fight' });
  await fight.getByLabel('Start from a preset').selectOption('Melee with one ability');
  await fight.getByLabel('Add from a preset').selectOption('Two-phase boss');
  // No server data folder in this profile, so spells are typed as IDs.
  const ids = fight.getByLabel('Spell ID');
  await ids.nth(0).fill('116');
  await ids.nth(1).fill('122');
  await expect(fight.getByRole('group', { name: 'Phases' })).toBeVisible();
  await page.screenshot({ path: 'test-results/combat-editor.png' });
  await card.getByRole('button', { name: 'Done' }).click();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Changes' }).click();
  const changes = page.getByRole('dialog', { name: 'Changes' });
  await expect(changes.getByRole('heading', { name: 'smart_scripts', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Export patch' }).click();
  await expect(page.getByText(/\.sql$/)).toBeVisible();
  const [file] = readdirSync(outDir);
  const sql = readFileSync(join(outDir, file!), 'utf8');
  expect(sql).toMatch(/fight\d+: Casts spell 116 on its current target every 10–15 s \(first after 3–6 s\) \(in Phase 1\)/);
  expect(sql).toMatch(/fight\d+: When it enters combat: go to phase 1: Phase 1 \(added automatically\)/);
  expect(sql).toMatch(/fight\d+: At 50% health \(in Phase 1\): go to phase 2: Phase 2/);
  expect(sql).toContain("'SmartAI'");
});
