import { describe, expect, it } from 'vitest';
import { createApi } from '../../src/main/api';
import { openStore } from '../../src/main/store/store';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta } from '../../src/main/project/project-file';
import type { ProjectController } from '../../src/main/project/controller';
import { npcFromRows } from '../../src/core/entities/from-rows';
import { forkDb } from '../helpers/fixtures';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };
const template = { entry: '1423', name: 'Stormwind Guard', subname: '', minlevel: '55', maxlevel: '56', faction: '11', rank: '1', type: '7', npcflag: '4097', lootid: '1423', unit_flags: '32768' };
const model = { CreatureID: '1423', Idx: '0', CreatureDisplayID: '3167', DisplayScale: '1', Probability: '1' };
const loot = { Entry: '1423', Item: '2589', Chance: '35', MinCount: '1', MaxCount: '2' };

async function setup() {
  const db = forkDb();
  db.insert('creature_template', template);
  db.insert('creature_template_model', model);
  db.insert('creature_loot_template', loot);
  const session = createProjectSession(defaultProjectMeta('P', 'C:\\out'));
  const written = new Map<string, string>();
  const api = createApi({ store: openStore(':memory:', box), openWorldDb: async () => db, openDevDb: async () => { throw new Error('x'); },
    fs: { writeFile: async (path: string, text: string) => { written.set(path, text); }, ensureDir: async () => {}, listDir: async () => [] },
    now: () => new Date('2026-10-05T00:00:00Z'), session, projects: {} as ProjectController });
  const rec: any = await api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p' });
  await api.connect(rec.value.id);
  // The rows as the database has them, as reading the existing NPC would give them
  const rows = {
    creature_template: await db.selectRows('creature_template', { entry: '1423' }),
    creature_template_model: await db.selectRows('creature_template_model', { CreatureID: '1423' }),
    creature_loot_template: await db.selectRows('creature_loot_template', { Entry: '1423' }),
  };
  const guard = npcFromRows(1423, rows as any, { sharedLoot: 0, spawnCount: 3 });
  return { api, db, guard, written };
}

describe('exporting an edited existing NPC', () => {
  it('exports an edited existing NPC in the project patch and its revert', async () => {
    const { api, guard, written } = await setup();
    await api.putProjectEntities({ npcs: [{ ...guard, minLevel: 60, maxLevel: 60 }], objects: [], items: [] });
    const out: any = await api.exportProject();
    expect(out.ok).toBe(true);
    expect(out.value.sql).toMatch(/INSERT INTO `creature_template` \(.*\) VALUES \(1423,.*60/);
    expect(out.value.sql).toMatch(/DELETE FROM `creature_loot_template` WHERE `Entry` = 1423/);
    const revert = written.get(out.value.revertPath)!;
    expect(revert).toMatch(/DELETE FROM `creature_template` WHERE `entry` = 1423/);
    expect(revert).toMatch(/INSERT INTO `creature_template` \(.*\) VALUES \(1423,.*'Stormwind Guard'.*, 55, 56, /);
    expect(revert).toMatch(/INSERT INTO `creature_loot_template` \(.*\) VALUES \(1423, 2589/);
    expect(out.value.warnings).toEqual([]);
  });

  it('warns, and still exports, when the database changed the NPC since it was edited here', async () => {
    const { api, db, guard } = await setup();
    await api.putProjectEntities({ npcs: [{ ...guard, minLevel: 60, maxLevel: 60 }], objects: [], items: [] });
    db.update('creature_template', { entry: '1423' }, { maxlevel: '58' });
    const out: any = await api.exportProject();
    expect(out.ok).toBe(true);
    expect(out.value.warnings).toEqual(['"Stormwind Guard" changed in the database since it was edited here; applying the patch overwrites that.']);
  });

  it('the Project changes badge and the export warning agree on drift (a second model added since)', async () => {
    const { api, db, guard } = await setup();
    await api.putProjectEntities({ npcs: [{ ...guard, minLevel: 56 }], objects: [], items: [] });
    db.insert('creature_template_model', { ...model, Idx: '1', CreatureDisplayID: '3168' });
    expect(((await api.existingDrift()) as any).value).toEqual([{ kind: 'npc', entry: 1423 }]);
    const out: any = await api.exportProject();
    expect(out.value.warnings).toEqual(['"Stormwind Guard" changed in the database since it was edited here; applying the patch overwrites that.']);
  });
});
