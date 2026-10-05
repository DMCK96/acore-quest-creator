import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * After a quest's Export patch: the project's new NPCs, objects and items are in the project patch,
 * which the export offers when the quest uses any. Writes it and reads it back.
 */
export async function exportProjectPatch(page: Page): Promise<string> {
  await page.getByRole('status').getByRole('button', { name: 'Export project patch' }).click();
  const path = (await page.getByText(/^Project patch written to/).locator('code').textContent())!;
  expect(path).toMatch(/\.sql$/);
  return readFileSync(path, 'utf8');
}
