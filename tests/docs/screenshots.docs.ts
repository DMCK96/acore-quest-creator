/**
 * Takes the docs site's screenshots from the real app: `npm run docs:screenshots`.
 *
 * It connects with the repo `.env` world DB (plus its server data and game client folders), builds
 * one demo quest from scratch and captures each screen the guides show into
 * `site/src/assets/screenshots/`. The tests run in order and share one window, so each builds on
 * the last.
 */
import { test, expect, _electron as electron, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { worldDbFromEnv } from './world-env';

// Playwright runs from the repo root.
const ROOT = resolve(process.cwd());
const OUT_DIR = join(ROOT, 'site/src/assets/screenshots');
const WIDTH = 1440;
const HEIGHT = 900;

// Fails here, before Electron starts, when `.env` has no world DB.
const envPath = join(ROOT, '.env');
if (!existsSync(envPath)) throw new Error('Set ACQC_WORLD_DB_HOST and ACQC_WORLD_DB_DATABASE in .env to take screenshots');
const world = worldDbFromEnv(readFileSync(envPath, 'utf8'));
if (!world.dbcDir) throw new Error('Set ACQC_WORLD_DB_DBC_DIR in .env: the map, ground height and spell names need the server data folder');
if (!world.clientDir) throw new Error('Set ACQC_WORLD_DB_CLIENT_DIR in .env: the map imagery needs the game client folder');

/** Saves the window as `<name>.png` and checks it came out at the docs' size. */
async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(400); // let modal and hover transitions settle
  const path = join(OUT_DIR, `${name}.png`);
  const png = await page.screenshot({ animations: 'disabled' });
  expect(png.readUInt32BE(16), `${name}.png width`).toBe(WIDTH);
  expect(png.readUInt32BE(20), `${name}.png height`).toBe(HEIGHT);
  writeFileSync(path, png);
}

/** Adds a spawn on an NPC or object editor's Placement tab from `.gps` output. */
async function spawnAt(editor: Locator, gps: string): Promise<void> {
  await editor.getByRole('tab', { name: 'Placement' }).click();
  await editor.getByRole('button', { name: 'Add spawn' }).click();
  await editor.getByLabel('Paste .gps output').fill(gps);
}

/**
 * Swaps the connection fields for generic values while `take` runs, so the images never show the
 * maintainer's own user name or folders, then puts the real values back.
 */
async function withGenericFields(scope: Page | Locator, take: () => Promise<void>): Promise<void> {
  const fields: [string, string, string][] = [
    ['User', 'acore', world.user],
    ['Server data folder (optional)', 'C:\\AzerothCore\\data\\dbc', world.dbcDir!],
    ['Game client folder (optional)', 'C:\\Games\\World of Warcraft 3.3.5a', world.clientDir!],
  ];
  for (const [label, generic] of fields) await scope.getByLabel(label, { exact: true }).fill(generic);
  await take();
  for (const [label, , real] of fields) await scope.getByLabel(label, { exact: true }).fill(real);
}

test.describe.serial('docs screenshots', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    // The app reads the repo `.env` itself (no ACQC_ENV_FILE) and shows it filled in on the login screen.
    app = await electron.launch({
      args: ['out/main/index.js'],
      cwd: ROOT,
      env: {
        ...(Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined))),
        ACQC_USER_DATA: mkdtempSync(join(tmpdir(), 'acqc-docs-ud-')),
        ACQC_OUTPUT_DIR: mkdtempSync(join(tmpdir(), 'acqc-docs-out-')),
      },
    });
    page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]!.setContentSize(size.w, size.h);
    }, { w: WIDTH, h: HEIGHT });
    await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  });

  test.afterAll(async () => {
    if (!app) return;
    // The demo quest is never saved: answer "Don't Save".
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as never;
    });
    await app.close();
  });

  test('login', async () => {
    await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
    await withGenericFields(page, () => shot(page, 'login'));
  });

  test('canvas', async () => {
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.getByRole('button', { name: 'New quest', exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Game client', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Add existing quest', exact: true }).click();
    await page.getByRole('searchbox').fill('The Defias Brotherhood');
    await page.getByRole('button', { name: /^The Defias Brotherhood \(\d+, level \d+\)$/ }).first().click();
    // The whole chain loads from the world DB before the preview opens.
    await expect(page.getByRole('complementary', { name: 'Quest preview' })).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('quest-node').first()).toBeVisible();
    await page.getByRole('button', { name: 'Close preview' }).click();
    await page.getByRole('button', { name: 'Fit view', exact: true }).click();
    await shot(page, 'canvas');
  });

  test('quest-details', async () => {
    await page.getByRole('button', { name: 'New quest', exact: true }).click();
    await page.getByLabel('Quest title').fill('The Lost Shipment');
    await page.getByLabel('Level', { exact: true }).fill('5');
    await page.getByLabel('Min level', { exact: true }).fill('3');
    await expect(page.getByRole('list', { name: 'Modules' })).toBeVisible();
    await shot(page, 'quest-details');
  });

  test('npc-editor', async () => {
    await page.getByRole('list', { name: 'Modules' }).getByRole('button', { name: /^Quest Giver/ }).click();
    const giver = page.getByRole('dialog', { name: 'Quest Giver' });
    await giver.getByRole('button', { name: 'Add quest giver' }).click();
    await giver.getByRole('button', { name: 'New NPC for starts at 1' }).click();
    const npc = page.getByRole('dialog', { name: 'New NPC' });
    await npc.getByLabel('Name', { exact: true }).fill('Foreman Brask');
    await npc.getByLabel('Title').fill('Dockmaster');
    await npc.getByLabel('Min level').fill('8');
    await npc.getByLabel('Max level').fill('8');
    await npc.getByRole('button', { name: 'Stormwind' }).click();
    await npc.getByRole('tab', { name: 'Look & gear' }).click();
    await npc.getByRole('combobox', { name: 'Look like…' }).fill('Stormwind City Guard');
    await page.getByRole('option', { name: /Stormwind City Guard/ }).first().click();
    await expect(npc.getByText(/^Looks like: .*\(display \d+\)$/)).toBeVisible();
    await shot(page, 'npc-editor');
    await npc.getByRole('button', { name: 'Done' }).click();
  });

  test('quest-giver', async () => {
    const giver = page.getByRole('dialog', { name: 'Quest Giver' });
    await expect(giver.getByRole('region', { name: 'Starts at 1' }).getByText('Foreman Brask')).toBeVisible();
    // He takes the quest back too.
    await giver.getByRole('button', { name: 'Add quest ender' }).click();
    await giver.getByRole('combobox', { name: 'Ends at 1' }).fill('Foreman Brask');
    await giver.getByRole('option', { name: /Foreman Brask · new · #\d+$/ }).click();
    // Checks run after each edit; wait for the "nothing takes this quest back" warning to clear.
    await expect(giver.getByText(/^Nothing takes this quest back/)).toHaveCount(0);
    await shot(page, 'quest-giver');
  });

  test('quest-map', async () => {
    const card = page.getByRole('dialog', { name: 'Quest Giver' }).getByRole('region', { name: 'Starts at 1' });
    await card.getByRole('button', { name: 'Place on map' }).click();
    const map = page.getByRole('dialog', { name: 'Quest map' });
    await expect(map.getByText('Click where Foreman Brask should stand.')).toBeVisible();
    await map.getByRole('combobox', { name: 'Map' }).selectOption({ label: 'Eastern Kingdoms' });
    await map.getByRole('combobox', { name: 'Jump to' }).fill('Marshal McBride');
    await map.getByRole('option', { name: /Marshal McBride/ }).first().click();
    const canvas = map.locator('.quest-map__canvas');
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(map.getByText('Placed. Drag to adjust, or draw its patrol.')).toBeVisible();
    await expect.poll(async () => Number(await canvas.getAttribute('data-dot-count'))).toBeGreaterThan(0);
    await page.waitForTimeout(2000); // relief and imagery tiles
    await shot(page, 'quest-map');
  });

  test('patrol', async () => {
    const map = page.getByRole('dialog', { name: 'Quest map' });
    const box = (await map.locator('.quest-map__canvas').boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await map.getByRole('button', { name: 'Draw patrol' }).click();
    await expect(map.getByRole('heading', { name: 'Patrol: Foreman Brask' })).toBeVisible();
    // Above and left of the spawn: its label runs off to the right and takes clicks of its own.
    await page.mouse.click(cx, cy - 80);
    await expect(map.getByRole('button', { name: 'Point 1', exact: true })).toBeVisible();
    await page.mouse.click(cx - 80, cy - 80);
    await expect(map.getByRole('button', { name: 'Point 2', exact: true })).toBeVisible();
    await page.mouse.click(cx - 80, cy);
    await expect(map.getByRole('button', { name: 'Point 3', exact: true })).toBeVisible();
    const point2 = map.locator('.quest-map__marker[title="Foreman Brask · patrol point 2"]');
    await point2.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Say something…' }).click();
    await map.getByRole('group', { name: 'Says' }).getByLabel('Line 1').fill('Where is that shipment?');
    await point2.click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Wait here…' })).toBeVisible();
    await shot(page, 'patrol');
    await page.keyboard.press('Escape');
    await map.getByRole('button', { name: 'Done' }).click();
    await map.getByRole('button', { name: 'Close' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Quest Giver' })).toHaveCount(0);
  });

  test('objectives', async () => {
    await page.getByRole('list', { name: 'Modules' }).getByRole('button', { name: /^Objectives/ }).click();
    const objectives = page.getByRole('dialog', { name: 'Objectives' });
    await objectives.getByRole('button', { name: 'Add kill or use' }).click();
    await objectives.getByRole('combobox', { name: /^Creature or object \d+$/ }).last().fill('Kobold Vermin');
    await objectives.getByRole('option', { name: / · #\d+$/ }).first().click();
    await objectives.getByRole('button', { name: 'Add collect' }).click();
    const item = objectives.getByRole('combobox', { name: /^Item \d+$/ }).last();
    await item.fill('Linen Cloth');
    await objectives.getByRole('option', { name: /Linen Cloth/ }).first().click();
    await shot(page, 'objectives');
    await page.keyboard.press('Escape');
    await expect(objectives).toHaveCount(0);
  });

  test('scripts', async () => {
    await page.getByRole('button', { name: 'Add module' }).click();
    await page.getByRole('menuitem', { name: /^Scripts/ }).click();
    const panel = page.getByRole('dialog', { name: 'Scripts' });
    await panel.getByRole('combobox', { name: 'Start from' }).selectOption('acceptSay');
    await panel.getByRole('button', { name: 'Add scene' }).click();
    const card = panel.getByRole('group', { name: /^Scene: / });
    await expect(card).toHaveCount(1);
    await card.getByLabel("Text ($N is the player's name)").fill('Find my crates before the kobolds do, $N.');
    await shot(page, 'scripts');
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
  });

  test('readable-object', async () => {
    // Making the giver's NPC already added this module to the quest.
    await page.getByRole('list', { name: 'Modules' }).getByRole('button', { name: /^NPCs & objects/ }).click();
    const panel = page.getByRole('dialog', { name: 'NPCs & objects' });
    await panel.getByRole('button', { name: 'Add object' }).click();
    const ledger = page.getByRole('dialog', { name: 'New object' });
    await ledger.getByLabel('Name', { exact: true }).fill("Brask's Ledger");
    await ledger.getByLabel('Type').selectOption('Readable');
    await ledger.getByRole('tab', { name: 'Look' }).click();
    await ledger.getByRole('button', { name: 'Other ways' }).click();
    await ledger.getByRole('combobox', { name: 'Browse models' }).fill('book');
    await page.getByRole('option', { name: /book/i }).first().click();
    await ledger.getByRole('tab', { name: 'Contents' }).click();
    await ledger.getByRole('button', { name: 'Add page' }).click();
    await ledger.getByLabel('Page 1').fill('Three crates of ore, bound for Goldshire. Last seen at the Echo Ridge Mine.');
    await shot(page, 'readable-object');
    await spawnAt(ledger, 'Map: 0 X: -8904.1 Y: -158.2 Z: 81.9 Orientation: 2');
    await ledger.getByRole('button', { name: 'Done' }).click();
    await expect(panel.getByRole('listitem', { name: "Brask's Ledger" })).toBeVisible();
  });

  test('loot', async () => {
    const panel = page.getByRole('dialog', { name: 'NPCs & objects' });
    await panel.getByRole('button', { name: 'Add object' }).click();
    const crate = page.getByRole('dialog', { name: 'New object' });
    await crate.getByLabel('Name', { exact: true }).fill('Salvaged Crate');
    await crate.getByLabel('Type').selectOption('Chest (can be looted)');
    await crate.getByRole('tab', { name: 'Look' }).click();
    await crate.getByRole('button', { name: 'Other ways' }).click();
    await crate.getByRole('combobox', { name: 'Browse models' }).fill('crate');
    await page.getByRole('option', { name: /crate/i }).first().click();
    await crate.getByRole('tab', { name: 'Contents' }).click();
    await crate.getByRole('button', { name: 'Add loot' }).click();
    await crate.getByRole('combobox', { name: 'Item' }).last().fill('Copper Ore');
    await page.getByRole('option', { name: /^Copper Ore/ }).first().click();
    await shot(page, 'loot');
    await spawnAt(crate, 'Map: 0 X: -8898.4 Y: -150.7 Z: 82.1 Orientation: 0');
    await crate.getByRole('button', { name: 'Done' }).click();
    await expect(panel.getByRole('listitem', { name: 'Salvaged Crate' })).toBeVisible();
  });

  test('combat', async () => {
    const panel = page.getByRole('dialog', { name: 'NPCs & objects' });
    await panel.getByRole('button', { name: 'Add NPC' }).click();
    const npc = page.getByRole('dialog', { name: 'New NPC' });
    await npc.getByLabel('Name', { exact: true }).fill('Grel the Tunnel Boss');
    await npc.getByRole('tab', { name: 'Look & gear' }).click();
    await npc.getByRole('combobox', { name: 'Look like…' }).fill('Kobold Tunneler');
    await page.getByRole('option', { name: /Kobold Tunneler/ }).first().click();
    await npc.getByRole('tab', { name: 'Fight' }).click();
    const fight = npc.getByRole('region', { name: 'Fight' });
    await fight.getByLabel('Start from a preset').selectOption('Melee with one ability');
    await fight.getByLabel('Add from a preset').selectOption('Two-phase boss');
    await expect(fight.getByRole('group', { name: 'Phases' })).toBeVisible();
    for (const spell of await fight.getByRole('combobox', { name: 'Spell' }).all()) {
      await spell.fill('Heroic Strike');
      await page.getByRole('option', { name: /Heroic Strike/ }).first().click();
    }
    // Picking spells scrolled down to the last ability; show the fight from its top.
    await npc.evaluate((dialog: { querySelectorAll(selector: string): ArrayLike<{ scrollTop: number }> }) => {
      for (const el of Array.from(dialog.querySelectorAll('*'))) el.scrollTop = 0;
    });
    await shot(page, 'combat');
    await spawnAt(npc, 'Map: 0 X: -8910.6 Y: -140.3 Z: 80.9 Orientation: 1');
    await npc.getByRole('button', { name: 'Done' }).click();
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
  });

  test('test-in-game', async () => {
    await page.getByRole('button', { name: 'Test in game' }).click();
    await expect(page.getByRole('dialog', { name: 'Test in game' })).toBeVisible();
    await shot(page, 'test-in-game');
    // Escape here would leave the quest for the canvas.
    await page.getByRole('dialog', { name: 'Test in game' }).getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('list', { name: 'Modules' })).toBeVisible();
  });

  test('changes', async () => {
    await page.getByRole('button', { name: 'Changes' }).click();
    const changes = page.getByRole('dialog', { name: 'Changes' });
    await expect(changes.getByRole('heading', { name: 'quest_template', exact: true })).toBeVisible();
    await shot(page, 'changes');
    await page.keyboard.press('Escape');
  });

  test('settings', async () => {
    await page.getByRole('button', { name: 'Settings' }).click();
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await expect(settings).toBeVisible();
    // Passwords stay masked in the image.
    await expect(settings.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'password');
    await withGenericFields(settings, () => shot(page, 'settings'));
    await settings.getByRole('button', { name: 'Close' }).click();
  });
});
