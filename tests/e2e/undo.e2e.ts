import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Undo across the app: changes made in the quest editor and the Project dialog are undone newest
 * first with Ctrl+Z, each with a note, and done again with Ctrl+Y. Only the world database is read;
 * nothing is exported or applied.
 */
function connectionEnv(): Record<string, string> {
  const raw = process.env['ACQC_TEST_MYSQL_URL'];
  if (!raw) return {};
  const u = new URL(raw);
  return {
    ACQC_ENV_FILE: 'none',
    ACQC_WORLD_DB_HOST: u.hostname, ACQC_WORLD_DB_PORT: u.port || '3306', ACQC_WORLD_DB_USER: decodeURIComponent(u.username),
    ACQC_WORLD_DB_PASSWORD: decodeURIComponent(u.password), ACQC_WORLD_DB_DATABASE: u.pathname.slice(1),
  };
}

const launch = () => electron.launch({
  args: ['out/main/index.js'],
  env: {
    ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && !/^ACQC_/.test(e[0]))),
    ACQC_USER_DATA: mkdtempSync(join(tmpdir(), 'acqc-ud-')), ACQC_OUTPUT_DIR: mkdtempSync(join(tmpdir(), 'acqc-out-')),
    ...connectionEnv(),
  },
});
/** Answers "Don't Save" to the unsaved-changes question, so closing leaves nothing behind */
const closeApp = async (app: ElectronApplication): Promise<void> => {
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as any; });
  await app.close();
};
const note = (page: Page) => page.getByRole('status').filter({ hasText: /^(Undid|Redid):/ });

/** Closes the Project dialog, so the keys that follow are the project's, not its name field's */
async function closeProjectDialog(page: Page): Promise<void> {
  const modal = page.getByRole('dialog', { name: 'Project' });
  await modal.getByRole('button', { name: 'Close' }).click();
  await expect(modal).toHaveCount(0);
}

async function newQuestTitled(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByRole('tab', { name: 'Quests' }).click();
  await page.getByRole('button', { name: 'New quest', exact: true }).click();
  await page.getByLabel('Quest title').fill(title);
  // Leaving the editor sends the edit, and leaves the keys to the project
  await page.getByRole('button', { name: '← Back to chain' }).click();
}

test('Ctrl+Z undoes the last changes anywhere, newest first, and Ctrl+Y does them again', async () => {
  const app = await launch();
  const page = await app.firstWindow();
  await newQuestTitled(page, 'Undo me');

  await page.getByRole('button', { name: 'Project', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Project' });
  await modal.getByLabel('Project name').fill('Undo test');
  await modal.getByLabel('Project name').press('Enter');
  await closeProjectDialog(page);
  await expect(page.getByRole('banner').getByRole('heading', { level: 1 })).toHaveText('Undo test');

  await page.keyboard.press('Control+z');
  await expect(note(page)).toContainText('Undid: Renamed the project');
  await expect(page.getByRole('banner').getByRole('heading', { level: 1 })).toHaveText('Untitled Project');
  await page.keyboard.press('Control+z');
  await expect(note(page)).toContainText('Undid: Quest title of Undo me');
  await page.keyboard.press('Control+z');
  await expect(note(page)).toContainText(/Undid: New quest \d+/);
  await expect(page.getByTestId('quest-node')).toHaveCount(0);

  await page.keyboard.press('Control+y');
  await expect(note(page)).toContainText(/Redid: New quest \d+/);
  await expect(page.getByTestId('quest-node')).toHaveCount(1);

  await page.getByRole('button', { name: 'History' }).click();
  // Three steps and the start of the session
  await expect(page.getByRole('menu', { name: 'History' }).getByRole('menuitem')).toHaveCount(4);
  await page.keyboard.press('Escape');
  await closeApp(app);
});

test('undoing back to the save makes the project clean again', async () => {
  const app = await launch();
  const page = await app.firstWindow();
  await newQuestTitled(page, 'Saved title');
  const saved = join(mkdtempSync(join(tmpdir(), 'acqc-proj-')), 'undo.aqc');
  await app.evaluate(({ dialog }, p) => { dialog.showSaveDialog = (async () => ({ canceled: false, filePath: p })) as any; }, saved);
  await page.keyboard.press('Control+Shift+s');
  await expect(page.getByLabel('Unsaved changes')).toHaveCount(0);

  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByRole('dialog', { name: 'Project' }).getByLabel('Project name').fill('After the save');
  await page.getByRole('dialog', { name: 'Project' }).getByLabel('Project name').press('Enter');
  await closeProjectDialog(page);
  await expect(page.getByLabel('Unsaved changes')).toBeVisible();

  await page.keyboard.press('Control+z');
  await expect(note(page)).toContainText('Undid: Renamed the project');
  await expect(page.getByLabel('Unsaved changes')).toHaveCount(0);
  await closeApp(app);
});
