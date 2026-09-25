import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
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

test('settings add and remove the dev database, and a bad reconnect keeps the old connection', async () => {
  const u = new URL(mysqlUrl());
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...withoutConnectionEnv(process.env), ACQC_USER_DATA: mkdtempSync(join(tmpdir(), 'acqc-ud-')), ACQC_OUTPUT_DIR: mkdtempSync(join(tmpdir(), 'acqc-out-')), ACQC_ENV_FILE: 'none' },
  });
  running = app;
  const page = await app.firstWindow();
  const db = { host: u.hostname, port: u.port || '3306', user: decodeURIComponent(u.username), database: u.pathname.slice(1), password: decodeURIComponent(u.password) };

  await page.getByLabel('Host').fill(db.host);
  await page.getByLabel('Port', { exact: true }).fill(db.port);
  await page.getByLabel('User').fill(db.user);
  await page.getByLabel('Database').fill(db.database);
  await page.getByLabel('Password').fill(db.password);
  await page.getByRole('button', { name: 'Save and connect' }).click();
  await expect(page.getByText(`Connected: ${db.database}`)).toBeVisible();

  await page.getByRole('button', { name: 'New quest', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply to dev DB' })).toBeDisabled();

  // Add a dev database (the world's own details stand in for it).
  await page.getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('button', { name: 'Add a dev database' }).click();
  await settings.getByLabel('Dev host', { exact: true }).fill(db.host);
  await settings.getByLabel('Dev port', { exact: true }).fill(db.port);
  await settings.getByLabel('Dev user', { exact: true }).fill(db.user);
  await settings.getByLabel('Dev database', { exact: true }).fill(db.database);
  await settings.getByLabel('Dev password', { exact: true }).fill(db.password);
  await settings.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(settings).toBeHidden();
  await expect(page.getByRole('button', { name: 'Apply to dev DB' })).toBeEnabled();

  // Remove it again.
  await page.getByRole('button', { name: 'Settings' }).click();
  await settings.getByRole('button', { name: 'Remove dev database' }).click();
  await settings.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(settings).toBeHidden();
  await expect(page.getByRole('button', { name: 'Apply to dev DB' })).toBeDisabled();

  // A wrong password: the error shows in the modal and the app stays connected.
  await page.getByRole('button', { name: 'Settings' }).click();
  await settings.getByLabel('Password', { exact: true }).fill('definitely-wrong-password');
  await settings.getByRole('button', { name: 'Save' }).click();
  await expect(settings.getByRole('alert')).toContainText(/denied|password/i);
  await expect(page.getByText(`Connected: ${db.database}`)).toBeVisible();
  await settings.getByRole('button', { name: 'Close' }).click();
  await expect(settings).toBeHidden();
});
