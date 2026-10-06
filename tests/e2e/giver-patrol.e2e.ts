import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mysqlUrl, serverDataDir } from '../helpers/env';
import { exportProjectPatch } from './project-patch';

// The server data and game client folders come from the same .env settings the app uses.
const DATA_DIR = serverDataDir();
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

test('a new quest giver is made, placed and given a patrol with a line to say, all from the giver card', async () => {
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
  await page.getByLabel('Server data folder (optional)').fill(DATA_DIR);
  await page.getByRole('button', { name: 'Save and connect' }).click();
  // The world is the home screen; the quest graph is in the Quests dock under it.
  await page.getByRole('button', { name: 'Quests', exact: true }).click();

  await page.getByRole('button', { name: 'New quest', exact: true }).click();
  await page.getByLabel('Quest title').fill('Patrol test');
  await page.getByRole('list', { name: 'Modules' }).getByRole('button', { name: /^Quest Giver/ }).click();
  const giver = page.getByRole('dialog', { name: 'Quest Giver' });
  await giver.getByRole('button', { name: 'Add quest giver' }).click();
  await giver.getByRole('button', { name: 'New NPC for starts at 1' }).click();
  const npc = page.getByRole('dialog', { name: 'New NPC' });
  await npc.getByLabel('Name', { exact: true }).fill('Patrol Hela');
  await npc.getByRole('tab', { name: 'Look & gear' }).click();
  await npc.getByRole('button', { name: 'Other ways' }).click();
  await npc.getByLabel('Display ID').fill('1234');
  await npc.getByRole('button', { name: 'Done' }).click();
  const card = giver.getByRole('region', { name: 'Starts at 1' });
  await expect(card.getByText('Patrol Hela')).toBeVisible();
  // Drawing the route is clicking in the 3D World, which needs a game client and a GL view; here the
  // spawn and its patrol (three points, a wait and a line at the second) are put into the project
  // through the API, and everything after that is the app's own.
  await page.evaluate(async () => {
    const api = (globalThis as any).api;
    const entities = (await api.projectEntities()).value;
    const guid = (await api.allocateIds('creatureSpawn', 1)).value[0];
    const point = (x: number, y: number, waitSecs: number, actions: unknown[]) => ({ x, y, z: 50, waitSecs, facing: null, paceFromHere: null, actions });
    const say = { id: 'a1', afterSecs: 0, kind: 'say', lines: [{ text: 'All quiet here.', style: 'say' }], chance: 100 };
    const patrol = { pathId: guid * 10, startPace: 'walk', points: [point(-8900, -160, 0, []), point(-8910, -160, 8, [say]), point(-8910, -150, 0, [])] };
    entities.npcs[0].spawns = [{ guid, map: 0, x: -8902.59, y: -162.606, z: 50, o: 0, respawnSecs: 300, wander: 0, patrol, rotation: null, events: 'npc' }];
    await api.putProjectEntities(entities);
  });
  await page.screenshot({ path: 'test-results/giver-patrol.png' });
  await page.keyboard.press('Escape');

  // The same NPC editor opens from NPCs, objects & items, with the patrol on its Placement tab.
  await page.getByRole('list', { name: 'Modules' }).getByRole('button', { name: /^NPCs, objects & items/ }).click();
  const entities = page.getByRole('dialog', { name: 'NPCs, objects & items' });
  await entities.getByRole('listitem', { name: 'Patrol Hela' }).getByRole('button', { name: 'Edit' }).click();
  const editor = page.getByRole('dialog', { name: 'NPC: Patrol Hela' });
  await editor.getByRole('tab', { name: 'Placement' }).click();
  await expect(editor.getByText('Walks a patrol of 3 points.')).toBeVisible();
  await editor.getByRole('button', { name: 'Done' }).click();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Export patch' }).click();
  await expect(page.getByText(/\.sql$/)).toBeVisible();
  // The NPC, its patrol and its lines are the project's: they are in the project patch
  const sql = await exportProjectPatch(page);
  expect(sql).toContain('Patrol Hela');
  expect(sql).toMatch(/INSERT INTO `creature_addon`/);
  // Three points, then back where it stands.
  expect(sql.match(/INSERT INTO `waypoint_data`/g)).toHaveLength(4);
  expect(sql).toMatch(/INSERT INTO `waypoint_data` .*, 8000,/);
  expect(sql).toContain('All quiet here.');
  expect(sql).toMatch(/INSERT INTO `smart_scripts` .*VALUES \(\d+, 0, 0, 0, 34, /);
});
