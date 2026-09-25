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

test('a scene added in the Scripts module shows in Changes and is exported with the quest', async () => {
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

  // A new quest opens straight into the editor.
  await page.getByRole('button', { name: 'New quest', exact: true }).click();
  await page.getByLabel('Quest title').fill('Scripted wolves');

  await page.getByRole('button', { name: 'Add module' }).click();
  await page.getByRole('menuitem', { name: /^Scripts/ }).click();
  const panel = page.getByRole('dialog', { name: 'Scripts' });
  await expect(panel).toBeVisible();

  await panel.getByRole('combobox', { name: 'Start from' }).selectOption('acceptSay');
  await panel.getByRole('button', { name: 'Add scene' }).click();
  const card = panel.getByRole('group', { name: /^Scene: / });
  await expect(card).toHaveCount(1);
  // The new quest has no giver yet, so the scene gets one by name.
  const npc = card.getByRole('combobox', { name: 'NPC', exact: true });
  await npc.fill('Marshal');
  await card.getByRole('option', { name: / · #\d+$/ }).first().click();
  await card.getByLabel("Text ($N is the player's name)").fill('Be careful out there, $N.');
  await page.screenshot({ path: 'test-results/scripts-module.png' });
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Changes' }).click();
  const changes = page.getByRole('dialog', { name: 'Changes' });
  await expect(changes.getByRole('heading', { name: 'smart_scripts' })).toBeVisible();
  await expect(changes.getByRole('heading', { name: 'creature_text' })).toBeVisible();
  await page.screenshot({ path: 'test-results/scripts-changes.png' });
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Export patch' }).click();
  await expect(page.getByText(/\.sql$/)).toBeVisible();
  const files = readdirSync(outDir);
  expect(files).toHaveLength(1);
  const sql = readFileSync(join(outDir, files[0]!), 'utf8');
  expect(sql).toMatch(/INSERT INTO `smart_scripts`[^\n]*AQC q\d+ s1: When the quest is accepted/);
  expect(sql).toContain('Be careful out there, $N.');
});
