import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mysqlUrl } from '../helpers/env';

const DATA_DIR = process.env.ACQC_WORLD_DB_DBC_DIR ? join(process.env.ACQC_WORLD_DB_DBC_DIR, '..') : 'E:\\Repositories\\azerothcore-wotlk-coa\\data';
const withoutConnectionEnv = (env: NodeJS.ProcessEnv): Record<string, string> =>
  Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => e[1] !== undefined && !/^ACQC_(WORLD|DEV)_DB_/.test(e[0])));

/** One exported row as column → value, from `INSERT INTO \`table\` (cols) VALUES (vals);`. */
function rowOf(sql: string, table: string): Record<string, string> {
  const line = sql.split('\n').find((l) => l.startsWith(`INSERT INTO \`${table}\` (`));
  if (!line) throw new Error(`no ${table} insert`);
  const [, cols, vals] = /\((.*?)\) VALUES \((.*)\);/.exec(line)!;
  const names = cols!.split(',').map((c) => c.trim().replace(/`/g, ''));
  const values = vals!.match(/'(?:[^'\\]|\\.)*'|[^,]+/g)!.map((v) => v.trim().replace(/^'|'$/g, ''));
  return Object.fromEntries(names.map((n, i) => [n, values[i] ?? '']));
}

async function connect(app: ElectronApplication) {
  const u = new URL(mysqlUrl());
  const page = await app.firstWindow();
  await page.getByLabel('Host').fill(u.hostname);
  await page.getByLabel('Port').fill(u.port || '3306');
  await page.getByLabel('User').fill(decodeURIComponent(u.username));
  await page.getByLabel('Database').fill(u.pathname.slice(1));
  await page.getByLabel('Password').fill(decodeURIComponent(u.password));
  await page.getByLabel('Server data folder (optional)').fill(DATA_DIR);
  await page.getByRole('button', { name: 'Save and connect' }).click();
  return page;
}

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
  await npc.getByRole('tab', { name: 'Placement' }).click();
  await npc.getByRole('button', { name: 'Add spawn' }).click();
  await npc.getByLabel('Paste .gps output').fill('Map: 0 X: -8913.2 Y: -136.5 Z: 80.5 Orientation: 1');
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
  // The spawn names equipment row 1: on a spawn, 0 would mean no weapons.
  expect(rowOf(sql, 'creature').equipment_id).toBe('1');
});

test('a new chest is made in the object modal with a look and loot, and exported', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'acqc-out-'));
  const app = await electron.launch({ args: ['out/main/index.js'],
    env: { ...withoutConnectionEnv(process.env), ACQC_USER_DATA: mkdtempSync(join(tmpdir(), 'acqc-ud-')), ACQC_OUTPUT_DIR: outDir, ACQC_ENV_FILE: 'none' } });
  running = app;
  const page = await connect(app);
  await page.getByRole('button', { name: 'New quest', exact: true }).click();
  await page.getByLabel('Quest title').fill('Chest test');
  await page.getByRole('button', { name: 'Add module' }).click();
  await page.getByRole('menuitem', { name: /^NPCs & objects/ }).click();
  const panel = page.getByRole('dialog', { name: 'NPCs & objects' });
  await panel.getByRole('button', { name: 'Add object' }).click();

  const chest = page.getByRole('dialog', { name: 'New object' });
  await chest.getByLabel('Name', { exact: true }).fill('Old Sea Chest');
  await chest.getByLabel('Type').selectOption('Chest (can be looted)');
  await chest.getByRole('tab', { name: 'Look' }).click();
  await chest.getByRole('button', { name: 'Other ways' }).click();
  await chest.getByRole('combobox', { name: 'Browse models' }).fill('chest');
  await page.getByRole('option', { name: /chest/i }).first().click();
  await expect(chest.getByText(/^Looks like: .*\(display \d+\)$/)).toBeVisible();
  await chest.getByRole('tab', { name: 'Contents' }).click();
  await chest.getByRole('button', { name: 'Add loot' }).click();
  await chest.getByRole('combobox', { name: 'Item' }).fill('Linen Cloth');
  await page.getByRole('option', { name: /^Linen Cloth/ }).first().click();
  await chest.getByRole('tab', { name: 'Placement' }).click();
  await chest.getByRole('button', { name: 'Add spawn' }).click();
  await chest.getByLabel('Paste .gps output').fill('Map: 0 X: -8913.2 Y: -136.5 Z: 80.5 Orientation: 1');
  await page.screenshot({ path: 'test-results/object-editor.png' });
  await chest.getByRole('button', { name: 'Done' }).click();
  await expect(panel.getByRole('listitem', { name: 'Old Sea Chest' }).getByText('Chest (can be looted) · placed')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Export patch' }).click();
  await expect(page.getByText(/\.sql$/)).toBeVisible();
  const sql = readFileSync(join(outDir, readdirSync(outDir)[0]!), 'utf8');
  const template = rowOf(sql, 'gameobject_template');
  expect(template).toMatchObject({ name: 'Old Sea Chest', type: '3' });
  expect(Number(template.displayId)).toBeGreaterThan(0);
  expect(sql).toMatch(/INSERT INTO `gameobject_loot_template`/);
  expect(sql).toMatch(/INSERT INTO `gameobject` /);
});
