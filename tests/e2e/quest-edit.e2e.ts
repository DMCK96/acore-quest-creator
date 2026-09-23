import { test, expect, _electron as electron } from '@playwright/test';
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

test('connect, add a quest to the canvas, edit it, review changes and export', async () => {
  const u = new URL(mysqlUrl());
  const userData = mkdtempSync(join(tmpdir(), 'acqc-ud-'));
  const outDir = mkdtempSync(join(tmpdir(), 'acqc-out-'));
  const app = await electron.launch({
    args: ['out/main/index.js'],
    // No `.env` and no connection variables from the shell: this test drives the connection form.
    env: { ...withoutConnectionEnv(process.env), ACQC_USER_DATA: userData, ACQC_OUTPUT_DIR: outDir, ACQC_ENV_FILE: 'none' },
  });
  const page = await app.firstWindow();

  await page.getByLabel('Host').fill(u.hostname);
  await page.getByLabel('Port').fill(u.port || '3306');
  await page.getByLabel('User').fill(decodeURIComponent(u.username));
  await page.getByLabel('Database').fill(u.pathname.slice(1));
  await page.getByLabel('Password').fill(decodeURIComponent(u.password));
  await page.getByRole('button', { name: 'Save and connect' }).click();

  // `exact` because the canvas empty state offers "+ Create New Quest" and "Add Existing Quest
  // Chain" beside the header's own buttons, and role-name matching is substring by default.
  await expect(page.getByRole('button', { name: 'New quest', exact: true })).toBeVisible(); // the canvas is the home screen
  await page.getByRole('button', { name: 'Add existing quest', exact: true }).click();
  await page.getByRole('searchbox').fill('a');
  await page.getByRole('button', { name: /level \d+\)/ }).first().click();
  // Scoped to the drawer: the header above the canvas carries the project name in its own `h1`, so
  // an unscoped level-1 heading matches two elements once the editor has finished mounting.
  const editor = page.getByRole('complementary', { name: 'Quest editor' });
  await expect(editor.getByRole('heading', { level: 1 })).toBeVisible();
  // "Add existing" imports the picked quest's whole chain, so there may be more than one node.
  await expect(page.getByTestId('quest-node').first()).toBeVisible();
  await expect(page.getByText(/unsafe to export/i)).toHaveCount(0);

  await page.getByRole('tab', { name: 'Story' }).click();
  const title = page.getByLabel('Quest title');
  const original = await title.inputValue();
  await title.fill(`${original} (edited)`);

  await page.getByRole('tab', { name: 'Changes' }).click();
  await expect(page.getByText(`${original} (edited)`)).toBeVisible();

  await page.getByRole('button', { name: 'Export patch' }).click();
  await expect(page.getByText(/\.sql$/)).toBeVisible();
  const files = readdirSync(outDir);
  expect(files).toHaveLength(1);
  expect(readFileSync(join(outDir, files[0]), 'utf8')).toContain(`${original} (edited)`.replace(/'/g, "\\'"));

  await page.getByRole('button', { name: 'Close editor' }).click();
  await expect(page.getByTestId('quest-node')).toContainText(`${original} (edited)`);

  await page.screenshot({ path: 'test-results/quest-edit.png' });
  await app.close();
});
