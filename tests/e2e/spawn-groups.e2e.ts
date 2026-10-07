import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clientDir, mysqlUrl, serverDataDir } from '../helpers/env';

/**
 * Spawn groups: two NPC spawns near the Time-Lost Proto-Drake's (guid 39203, Dragonblight) are grouped
 * from the World's right-click menu, and the project patch carries the pool.
 */
const withoutConnectionEnv = (env: NodeJS.ProcessEnv): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).filter(
      (e): e is [string, string] => e[1] !== undefined && !/^ACQC_(WORLD|DEV)_DB_/.test(e[0]) && e[0] !== 'ELECTRON_RUN_AS_NODE',
    ),
  );

let running: ElectronApplication | undefined;
test.afterEach(async () => {
  if (!running) return;
  await running.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as never;
  });
  await running.close();
  running = undefined;
});

test('two spawns are grouped in the World and the project patch carries the pool', async () => {
  test.skip(!process.env.ACQC_TEST_CLIENT_DIR, 'needs a game client');
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
  await page.getByLabel('Server data folder (optional)').fill(serverDataDir());
  await page.getByLabel('Game client folder (optional)').fill(process.env.ACQC_TEST_CLIENT_DIR ?? clientDir());
  await page.getByRole('button', { name: 'Save and connect' }).click();
  await expect(page.getByRole('button', { name: 'Quests', exact: true })).toBeVisible({ timeout: 30_000 });

  const welcome = page.getByRole('dialog', { name: 'Welcome' });
  await expect(welcome).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(welcome).toHaveCount(0);

  // Dragonblight: Find the drake's NPC and go to its spawn (guid 39203)
  await page.getByRole('button', { name: 'Find…' }).click();
  const find = page.getByRole('dialog', { name: 'Find an NPC or object' });
  await find.getByLabel('Find by name or ID').fill('Time-Lost Proto-Drake');
  await find.getByRole('list', { name: 'Matches' }).getByRole('button').first().click();
  const go = find.getByRole('button', { name: 'Go to spawn 39203' });
  await expect(go).toBeEnabled({ timeout: 90_000 });
  await go.click();
  await expect(find).toHaveCount(0);

  // Select tool, then a box over the middle of the view takes in the drake and a neighbour
  await page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Select' }).click();
  const box = (await page.locator('.world3d__stage canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.8, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByRole('region', { name: 'Selection' })).toBeVisible();

  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5, { button: 'right' });
  await page.getByRole('menuitem', { name: /^Group these spawns…/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Spawn group' });
  await dialog.getByLabel('Name', { exact: true }).fill('Test group');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByRole('button', { name: /^Project changes \(\d+\)$/ }).click();
  const changes = page.getByRole('dialog', { name: 'Project changes' });
  await changes.getByRole('button', { name: 'Export project patch' }).click();
  const written = (await changes.locator('.world-changes__exported p').nth(1).textContent())!.trim();
  const sql = readFileSync(written, 'utf8');
  expect(sql).toMatch(/INSERT INTO `pool_template` .*'Test group'/);
  expect(sql.match(/INSERT INTO `pool_creature`/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  // Stops here: nothing is applied to any database.
});

// Loads the patch in the real server. It applies the patch to the DEV database, starts the fork's
// worldserver (<fork>/build-server/bin/RelWithDebInfo, its generated config), waits for
// "World initialized", checks Server.log for errors naming `pool_` tables for the new pool id, and
// then applies the revert patch. It changes a database and runs a server, so it only runs on request.
test('the pool loads in the fork\'s worldserver without pool errors, then is reverted', async () => {
  test.skip(!process.env.ACQC_TEST_DEV_SERVER, 'applies the patch to the dev database and starts worldserver; set ACQC_TEST_DEV_SERVER to run');
  // Steps: export the patch as above; apply it to the dev database (Apply to dev, or mysql with the
  // ACQC_DEV_DB_* profile); start worldserver; wait for "World initialized"; assert Server.log has no
  // line matching /`pool_/ for the new pool id; stop worldserver; apply _project_revert.sql.
  throw new Error('Run by hand: see the comment above');
});
