import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const userData = mkdtempSync(join(tmpdir(), 'acqc-ud-'));
const work = mkdtempSync(join(tmpdir(), 'acqc-proj-'));
const saved = join(work, 'e2e.aqc');
const recoveryDir = join(userData, 'recovery');

/**
 * The connection: `ACQC_TEST_MYSQL_URL` when it is set, otherwise the repo's `.env`, which the
 * unpackaged app reads itself. Either way the app connects on launch and lands on the canvas. This
 * test only reads from the world database; it never exports or applies anything.
 */
function connectionEnv(): Record<string, string> {
  const raw = process.env['ACQC_TEST_MYSQL_URL'];
  if (!raw) return {};
  const u = new URL(raw);
  return {
    ACQC_ENV_FILE: 'none',
    ACQC_WORLD_DB_HOST: u.hostname, ACQC_WORLD_DB_PORT: u.port || '3306', ACQC_WORLD_DB_USER: decodeURIComponent(u.username),
    ACQC_WORLD_DB_PASS: decodeURIComponent(u.password), ACQC_WORLD_DB_DATABASE: u.pathname.slice(1),
  };
}

const launch = () => electron.launch({
  args: ['out/main/index.js'],
  env: {
    ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && !/^ACQC_/.test(e[0]))),
    ACQC_USER_DATA: userData, ACQC_OUTPUT_DIR: mkdtempSync(join(tmpdir(), 'acqc-out-')),
    ACQC_RECOVERY_INTERVAL_MS: '300',
    ...connectionEnv(),
  },
});
const stubSave = (app: ElectronApplication, path: string) =>
  app.evaluate(({ dialog }, p) => { dialog.showSaveDialog = (async () => ({ canceled: false, filePath: p })) as any; }, path);
const stubUnsaved = (app: ElectronApplication, response: number) =>
  app.evaluate(({ dialog }, r) => { dialog.showMessageBox = (async () => ({ response: r, checkboxChecked: false })) as any; }, response);

test('new, name, save, reopen from recent, and recover after a crash', async () => {
  let app = await launch();
  let page = await app.firstWindow();
  const heading = page.getByRole('banner').getByRole('heading', { level: 1 });
  await expect(heading).toHaveText('Untitled Project');

  await page.getByRole('button', { name: 'Add existing quest', exact: true }).click();
  await page.getByRole('searchbox').fill('a');
  await page.getByRole('button', { name: /level \d+\)/ }).first().click();
  await page.getByRole('button', { name: 'Close editor' }).click();
  await expect(page.getByTestId('quest-node').first()).toBeVisible();
  const nodeCount = await page.getByTestId('quest-node').count();
  expect(nodeCount).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Project' }).click();
  const modal = page.getByRole('dialog', { name: 'Project' });
  await modal.getByLabel('Project name').fill('E2E project');
  await modal.getByLabel('Project name').press('Enter');
  await stubSave(app, saved);
  await modal.getByRole('button', { name: 'Save As…' }).click();
  await expect(page.getByLabel('Unsaved changes')).toHaveCount(0);
  const onDisk = JSON.parse(readFileSync(saved, 'utf8'));
  expect(onDisk).toMatchObject({ format: 'acore-quest-creator/project', version: 1, name: 'E2E project' });
  expect(onDisk.quests).toHaveLength(nodeCount);

  await page.getByRole('button', { name: 'Project' }).click();
  await modal.getByRole('button', { name: 'New project…' }).click();
  await modal.getByLabel('New project name').fill('Second');
  await modal.getByRole('button', { name: 'Create' }).click();
  await expect(heading).toHaveText('Second');
  await expect(page.getByTestId('quest-node')).toHaveCount(0);

  await page.getByRole('button', { name: 'Project' }).click();
  await modal.getByRole('button', { name: /^Open E2E project/ }).click();
  await expect(heading).toHaveText('E2E project');
  await expect(page.getByTestId('quest-node')).toHaveCount(nodeCount);

  // Unsaved work, then a crash.
  await page.getByRole('button', { name: 'Project' }).click();
  await modal.getByLabel('Project name').fill('Crashed name');
  await modal.getByLabel('Project name').press('Enter');
  await expect.poll(() => (existsSync(recoveryDir) ? readdirSync(recoveryDir).length : 0), { timeout: 5000 }).toBe(1);
  app.process().kill('SIGKILL');

  app = await launch();
  page = await app.firstWindow();
  const prompt = page.getByRole('alertdialog', { name: 'Recover unsaved work' });
  await expect(prompt).toContainText('Crashed name');
  await prompt.getByRole('button', { name: 'Restore Crashed name' }).click();
  await expect(page.getByRole('banner').getByRole('heading', { level: 1 })).toHaveText('Crashed name');
  await expect(page.getByLabel('Unsaved changes')).toBeVisible();
  await expect(page.getByTestId('quest-node')).toHaveCount(nodeCount);

  // Closing with unsaved changes and choosing Don't Save quits and leaves no recovery copy.
  await stubUnsaved(app, 1);
  await page.screenshot({ path: 'test-results/project.png' });
  await app.close();
  expect(existsSync(recoveryDir) ? readdirSync(recoveryDir) : []).toEqual([]);
});
