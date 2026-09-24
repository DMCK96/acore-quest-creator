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
  await running.evaluate(({ dialog }) => { dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as never; });
  await running.close();
  running = undefined;
});

test('a new quest giver is made in the NPC modal with a guard\'s look and weapons, and exported', async () => {
  const u = new URL(mysqlUrl());
  const outDir = mkdtempSync(join(tmpdir(), 'acqc-out-'));
  const app = await electron.launch({ args: ['out/main/index.js'],
    env: { ...withoutConnectionEnv(process.env), ACQC_USER_DATA: mkdtempSync(join(tmpdir(), 'acqc-ud-')), ACQC_OUTPUT_DIR: outDir, ACQC_ENV_FILE: 'none' } });
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
  await page.getByLabel('Quest title').fill('Editor test');
  await page.getByRole('list', { name: 'Modules' }).getByRole('button', { name: /^Quest Giver/ }).click();
  const giver = page.getByRole('dialog', { name: 'Quest Giver' });
  await giver.getByRole('button', { name: 'Add quest giver' }).click();
  await giver.getByRole('button', { name: 'New NPC for starts at 1' }).click();

  const npc = page.getByRole('dialog', { name: 'New NPC' });
  await npc.getByLabel('Name').fill('Captain Vessa');
  await npc.getByLabel('Title').fill('Watch Captain');
  await npc.getByLabel('Min level').fill('20');
  await npc.getByLabel('Max level').fill('20');
  await npc.getByRole('button', { name: 'Stormwind' }).click();
  await npc.getByRole('tab', { name: 'Look & gear' }).click();
  await npc.getByRole('combobox', { name: 'Look like…' }).fill('Stormwind City Guard');
  await page.getByRole('option', { name: /Stormwind City Guard/ }).first().click();
  await expect(npc.getByText(/^Looks like: .*\(display \d+\)$/)).toBeVisible();
  await page.screenshot({ path: 'test-results/npc-editor.png' });
  await npc.getByRole('button', { name: 'Done' }).click();
  await expect(giver.getByRole('region', { name: 'Starts at 1' }).getByText('Captain Vessa')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Export patch' }).click();
  await expect(page.getByText(/\.sql$/)).toBeVisible();
  const sql = readFileSync(join(outDir, readdirSync(outDir)[0]!), 'utf8');
  expect(sql).toContain('Captain Vessa');
  expect(sql).toContain('Watch Captain');
  expect(sql).toMatch(/INSERT INTO `creature_template_model` .*VALUES \(\d+, 0, [1-9]\d*,/);
  expect(sql).toMatch(/INSERT INTO `creature_equip_template`/);
});
