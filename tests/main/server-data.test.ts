import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServerDataFiles, loadServerData, nodeServerDataFiles } from '../../src/main/server-data';
import { questXpDbc } from '../helpers/dbc';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'acqc-data-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('loadServerData', () => {
  it('is null when the profile names no folder', async () => {
    expect(await loadServerData('', nodeServerDataFiles)).toBeNull();
  });
  it('reads QuestXP.dbc from the dbc folder under DataDir, in any letter case', async () => {
    await mkdir(join(dir, 'dbc'));
    await writeFile(join(dir, 'dbc', 'questxp.DBC'), questXpDbc([10]));
    const data = await loadServerData(dir, nodeServerDataFiles);
    expect(data?.status).toEqual({ dir, loaded: ['QuestXP.dbc'], problems: [] });
    expect(data?.questXp?.get(10)?.[5]).toBe(5000);
  });
  it('accepts the dbc folder itself', async () => {
    await writeFile(join(dir, 'QuestXP.dbc'), questXpDbc([10]));
    expect((await loadServerData(dir, nodeServerDataFiles))?.questXp?.get(10)?.[1]).toBe(1000);
  });
  it('reports a missing folder, a missing file and a broken file as problems, never throwing', async () => {
    const gone = join(dir, 'nope');
    expect((await loadServerData(gone, nodeServerDataFiles))?.status.problems).toEqual([
      `The server data folder ${gone} does not exist.`,
    ]);
    expect((await loadServerData(dir, nodeServerDataFiles))?.status.problems).toEqual([
      `QuestXP.dbc is not in ${dir} or its dbc folder.`,
    ]);
    await writeFile(join(dir, 'QuestXP.dbc'), 'not a dbc file at all');
    const broken = await loadServerData(dir, nodeServerDataFiles);
    expect(broken?.questXp).toBeNull();
    expect(broken?.status.problems[0]).toMatch(/^QuestXP\.dbc could not be read: .*not a WDBC file/);
  });
});

describe('reading the server data folder', () => {
  it('lists a folder once for many reads, and looks again for a missing file after a while', async () => {
    let now = 0;
    let listings = 0;
    const files = createServerDataFiles({ listingTtlMs: 60_000, now: () => now, onList: () => { listings += 1; } });
    await writeFile(join(dir, 'a.map'), 'A');
    expect(await files.read(dir, 'a.map')).not.toBeNull();
    expect(await files.read(dir, 'missing.map')).toBeNull();
    expect(await files.read(dir, 'A.MAP')).not.toBeNull();
    expect(listings).toBe(1);
    await writeFile(join(dir, 'b.map'), 'B');
    expect(await files.read(dir, 'b.map')).toBeNull();
    now += 61_000;
    expect(await files.read(dir, 'b.map')).not.toBeNull();
    expect(listings).toBe(2);
  });
});
