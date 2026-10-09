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

  it('exports stock added to an existing NPC, filling the columns the editor does not set', async () => {
    const { api, db } = await setup();
    const rows = {
      creature_template: await db.selectRows('creature_template', { entry: '1423' }),
      creature_template_model: await db.selectRows('creature_template_model', { CreatureID: '1423' }),
      creature_loot_template: await db.selectRows('creature_loot_template', { Entry: '1423' }),
      npc_vendor: [],
    };
    const guard = npcFromRows(1423, rows as any, { sharedLoot: 0, spawnCount: 3 });
    await api.putProjectEntities({ npcs: [{ ...guard, vendor: [{ item: 159, maxCount: 0, restockSecs: 0, extendedCost: 0 }] }], objects: [], items: [] });
    const out: any = await api.exportProject();
    expect(out.ok).toBe(true);
    expect(out.value.sql).toMatch(/DELETE FROM `npc_vendor` WHERE `entry` = 1423/);
    expect(out.value.sql).toMatch(/INSERT INTO `npc_vendor` \(.*\) VALUES \(1423, 0, 159, 0, 0, 0, /);
  });

  describe('an existing NPC\'s trainer', () => {
    const trainerRows = async (db: any) => ({
      creature_template: await db.selectRows('creature_template', { entry: '1423' }),
      creature_template_model: await db.selectRows('creature_template_model', { CreatureID: '1423' }),
      creature_loot_template: await db.selectRows('creature_loot_template', { Entry: '1423' }),
      creature_default_trainer: await db.selectRows('creature_default_trainer', { CreatureId: '1423' }),
      trainer: await db.selectRows('trainer', { Id: '5' }),
      trainer_spell: await db.selectRows('trainer_spell', { TrainerId: '5' }),
    });
    const lesson = { spell: 5, cost: 1, reqLevel: 2, reqSkill: 0, reqSkillRank: 0, reqSpells: [78] };

    it('exports a database NPC made a trainer, filling the columns the editor does not set', async () => {
      const { api, db } = await setup();
      const npc = npcFromRows(1423, await trainerRows(db) as any, { sharedLoot: 0, spawnCount: 3, sharedTrainer: 0 });
      await api.putProjectEntities({ npcs: [{ ...npc, trainer: { trainerId: 900033, type: 'profession', requirement: 0, greeting: 'Hi', spells: [lesson] } }], objects: [], items: [] });
      const out: any = await api.exportProject();
      expect(out.ok, JSON.stringify(out.error)).toBe(true);
      expect(out.value.sql).toMatch(/INSERT INTO `trainer` \(.*\) VALUES \(900033, 2, 0, 'Hi', /);
      expect(out.value.sql).toMatch(/INSERT INTO `trainer_spell` \(.*\) VALUES \(900033, 5, /);
      expect(out.value.sql).toMatch(/INSERT INTO `creature_default_trainer` \(.*\) VALUES \(1423, 900033\)/);
    });

    it('exports a spell added to the NPC\'s own trainer', async () => {
      const { api, db } = await setup();
      db.insert('trainer', { Id: '5', Type: '0', Requirement: '1', Greeting: 'Hi', VerifiedBuild: '12340' });
      db.insert('trainer_spell', { TrainerId: '5', SpellId: '78', MoneyCost: '10', ReqLevel: '1', VerifiedBuild: '12340' });
      db.insert('creature_default_trainer', { CreatureId: '1423', TrainerId: '5' });
      const npc = npcFromRows(1423, await trainerRows(db) as any, { sharedLoot: 0, spawnCount: 3, sharedTrainer: 0 });
      await api.putProjectEntities({ npcs: [{ ...npc, trainer: { ...npc.trainer!, spells: [...npc.trainer!.spells, lesson] } }], objects: [], items: [] });
      const out: any = await api.exportProject();
      expect(out.ok, JSON.stringify(out.error)).toBe(true);
      expect(out.value.sql).toMatch(/INSERT INTO `trainer_spell` \(.*\) VALUES \(5, 5, 1, /);
    });

    it('exports a shared trainer\'s NPC given its own copy, leaving the shared trainer alone', async () => {
      const { api, db } = await setup();
      db.insert('trainer', { Id: '5', Type: '0', Requirement: '1', Greeting: 'Hi', VerifiedBuild: '12340' });
      db.insert('trainer_spell', { TrainerId: '5', SpellId: '78', MoneyCost: '10', ReqLevel: '1', VerifiedBuild: '12340' });
      db.insert('creature_default_trainer', { CreatureId: '1423', TrainerId: '5' });
      db.insert('creature_default_trainer', { CreatureId: '68', TrainerId: '5' });
      const npc = npcFromRows(1423, await trainerRows(db) as any, { sharedLoot: 0, spawnCount: 3, sharedTrainer: 1 });
      expect((npc.origin as { locked: string[] }).locked).toEqual(['trainer']);
      const copied = { ...npc, trainer: { ...npc.trainer!, trainerId: 900033 }, origin: { ...npc.origin, locked: [] } } as typeof npc;
      await api.putProjectEntities({ npcs: [copied], objects: [], items: [] });
      const out: any = await api.exportProject();
      expect(out.ok, JSON.stringify(out.error)).toBe(true);
      expect(out.value.sql).toMatch(/INSERT INTO `trainer` \(.*\) VALUES \(900033, 0, 1, 'Hi', /);
      expect(out.value.sql).toMatch(/INSERT INTO `creature_default_trainer` \(.*\) VALUES \(1423, 900033\)/);
      expect(out.value.sql).not.toMatch(/(DELETE FROM|INSERT INTO) `trainer(_spell)?` .*(`Id` = 5|`TrainerId` = 5)\b/);
    });
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
