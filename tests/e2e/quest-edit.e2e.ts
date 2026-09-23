import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
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

// Closed after each test even when it fails, so a failure cannot leave a window behind for the next test.
let running: ElectronApplication | undefined;
test.afterEach(async () => {
  if (!running) return;
  // The quest was edited, so quitting asks to save the project; answer "Don't Save".
  await running.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as never;
  });
  await running.close();
  running = undefined;
});

/** Launches the app, connects through the form and adds an existing quest chain to the canvas. */
async function connectAndAddQuest(): Promise<{ app: ElectronApplication; page: Page; outDir: string }> {
  const u = new URL(mysqlUrl());
  const userData = mkdtempSync(join(tmpdir(), 'acqc-ud-'));
  const outDir = mkdtempSync(join(tmpdir(), 'acqc-out-'));
  const app = await electron.launch({
    args: ['out/main/index.js'],
    // No `.env` and no connection variables from the shell: this test drives the connection form.
    env: { ...withoutConnectionEnv(process.env), ACQC_USER_DATA: userData, ACQC_OUTPUT_DIR: outDir, ACQC_ENV_FILE: 'none' },
  });
  running = app;
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
  return { app, page, outDir };
}

test('connect, preview a quest, edit it in the module flow, review changes and export', async () => {
  const { page, outDir } = await connectAndAddQuest();

  // Picking a quest from "Add existing" previews it beside the chain.
  const preview = page.getByRole('complementary', { name: 'Quest preview' });
  await expect(preview).toBeVisible();
  // "Add existing" imports the picked quest's whole chain, so there may be more than one node.
  await expect(page.getByTestId('quest-node').first()).toBeVisible();
  await expect(page.getByText(/unsafe to export/i)).toHaveCount(0);
  await preview.getByRole('button', { name: 'Edit quest' }).click();

  // The editor is the module flow, not tabs.
  await expect(page.getByRole('list', { name: 'Modules' })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(0);

  const title = page.getByLabel('Quest title');
  const original = await title.inputValue();
  await title.fill(`${original} (edited)`);

  // Add a kill objective by searching a creature name, when the quest still has a free slot.
  await page.getByRole('button', { name: /^Objectives/ }).click();
  const objectives = page.getByRole('dialog', { name: 'Objectives' });
  const addKill = objectives.getByRole('button', { name: 'Add kill or use' });
  if (await addKill.isEnabled()) {
    await addKill.click();
    const pickers = objectives.getByRole('combobox', { name: /^Creature or object \d+$/ });
    await pickers.last().fill('wolf');
    // The search results, not the NPC/Object choices of the kind dropdown.
    await objectives.getByRole('option', { name: / · #\d+$/ }).first().click();
    await expect(pickers.last()).toHaveValue(/wolf/i);
  }
  await page.keyboard.press('Escape');
  await expect(objectives).toHaveCount(0);

  await page.getByRole('button', { name: 'Changes' }).click();
  await expect(page.getByRole('dialog', { name: 'Changes' }).getByText(`${original} (edited)`)).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Export patch' }).click();
  await expect(page.getByText(/\.sql$/)).toBeVisible();
  const files = readdirSync(outDir);
  expect(files).toHaveLength(1);
  expect(readFileSync(join(outDir, files[0]), 'utf8')).toContain(`${original} (edited)`.replace(/'/g, "\\'"));
  await page.screenshot({ path: 'test-results/quest-edit.png' });

  await page.getByRole('button', { name: '← Back to chain' }).click();
  await expect(page.getByRole('complementary', { name: 'Quest preview' })).toBeVisible();
  await page.getByRole('button', { name: 'Close preview' }).click();
  // The chain puts several nodes on the canvas; exactly one of them carries the edited title.
  await expect(page.getByTestId('quest-node').filter({ hasText: `${original} (edited)` })).toHaveCount(1);

});

test('an imported quest previewed and opened without edits has no changes', async () => {
  const { page } = await connectAndAddQuest();
  await page.getByRole('complementary', { name: 'Quest preview' }).getByRole('button', { name: 'Edit quest' }).click();
  await page.getByRole('button', { name: 'Changes' }).click();
  await expect(page.getByText('No changes since this quest was loaded.')).toBeVisible();
});
