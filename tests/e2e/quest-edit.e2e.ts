import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mysqlUrl } from '../helpers/env';

test('connect, add a quest to the canvas, edit it, review changes and export', async () => {
  const u = new URL(mysqlUrl());
  const userData = mkdtempSync(join(tmpdir(), 'acqc-ud-'));
  const outDir = mkdtempSync(join(tmpdir(), 'acqc-out-'));
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, ACQC_USER_DATA: userData, ACQC_OUTPUT_DIR: outDir },
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
  await expect(page.getByTestId('quest-node')).toHaveCount(1);
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
