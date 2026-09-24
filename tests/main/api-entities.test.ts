import { describe, expect, it } from 'vitest';
import { createApi } from '../../src/main/api';
import { openStore } from '../../src/main/store/store';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta } from '../../src/main/project/project-file';
import type { ProjectController } from '../../src/main/project/controller';
import { ENTITIES_FIELD, newNpc, newSpawn, writeEntities } from '../../src/core/entities/model';
import { forkDb } from '../helpers/fixtures';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };

async function setup() {
  const db = forkDb();
  db.insert('creature_template', { entry: '11000230', name: 'Saprophyte Amalgam', minlevel: '30', maxlevel: '31', faction: '14', rank: '1', type: '4' });
  db.insert('creature_template_model', { CreatureID: '11000230', Idx: '0', CreatureDisplayID: '4321', DisplayScale: '1.5', Probability: '1' });
  db.insert('creature', { guid: '5300681', id1: '11000230' });
  const api = createApi({ store: openStore(':memory:', box), openWorldDb: async () => db, openDevDb: async () => { throw new Error('x'); },
    fs: { writeFile: async () => {}, ensureDir: async () => {}, listDir: async () => [] }, now: () => new Date('2026-09-24T00:00:00Z'),
    session: createProjectSession(defaultProjectMeta('P', 'C:\\out')), projects: {} as ProjectController });
  const rec: any = await api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p' });
  await api.connect(rec.value.id);
  return { api, db };
}

describe('new NPCs through the API', () => {
  it('allocates ids above the database and the project', async () => {
    const { api } = await setup();
    const first: any = await api.allocateIds('creature', 2);
    expect(first.value).toEqual([11000231, 11000232]);
    const opened: any = await api.newQuest();
    const aggregate = opened.value.aggregate;
    aggregate.values[ENTITIES_FIELD] = writeEntities({ npcs: [{ ...newNpc(11000235), name: 'A', displayId: 1, spawns: [newSpawn(5300700)] }], objects: [] });
    await api.updateQuest(aggregate);
    expect(((await api.allocateIds('creature', 1)) as any).value).toEqual([11000236]);
    expect(((await api.allocateIds('creatureSpawn', 1)) as any).value).toEqual([5300701]);
  });

  it('allocates page ids above the database', async () => {
    const { api, db } = await setup();
    db.insert('page_text', { ID: '3622', Text: 'x', NextPageID: '0' });
    expect(((await api.allocateIds('page', 1)) as any).value).toEqual([3623]);
  });

  it('copies look and stats from an existing NPC', async () => {
    const { api } = await setup();
    const copy: any = await api.entityTemplate('creature', 11000230);
    expect(copy.value).toMatchObject({ name: 'Saprophyte Amalgam', minLevel: 30, maxLevel: 31, faction: 14, rank: 'elite', type: 'elemental', displayId: 4321, scale: 1.5 });
  });

  it('finds new NPCs by name, treats them as real givers and exports them', async () => {
    const { api } = await setup();
    const opened: any = await api.newQuest();
    const aggregate = opened.value.aggregate;
    aggregate.values['quest_template.LogTitle'] = 'Meet Hela';
    aggregate.values[ENTITIES_FIELD] = writeEntities({ npcs: [{ ...newNpc(11000240), name: 'Scout Hela', displayId: 1234, spawns: [{ ...newSpawn(5300800), x: 5 }] }], objects: [] });
    aggregate.values.creature_queststarter = [{ id: 11000240 }];
    aggregate.values.creature_questender = [{ id: 11000240 }];
    await api.updateQuest(aggregate);

    const hits: any = await api.searchEntities('creature', 'Hela');
    expect(hits.value[0]).toMatchObject({ id: 11000240, name: 'Scout Hela', detail: 'new' });
    const names: any = await api.lookupNames('creature', [11000240]);
    expect(names.value[11000240]).toBe('Scout Hela');

    const issues: any = await api.validate(aggregate.questId);
    expect(issues.value.filter((i: any) => i.severity === 'error')).toEqual([]);

    const out: any = await api.exportQuest(aggregate.questId);
    expect(out.ok).toBe(true);
    expect(out.value.sql).toMatch(/INSERT INTO `creature_template` \(.*\) VALUES \(11000240,/);
    expect(out.value.sql).toMatch(/INSERT INTO `creature` .*'AQC q\d+ npc11000240'/);
    expect(out.value.sql.indexOf('INSERT INTO `creature_template`')).toBeLessThan(out.value.sql.indexOf('INSERT INTO `creature_queststarter`'));
  });
  it('copies an NPC\'s weapons with its look', async () => {
    const { api, db } = await setup();
    db.insert('creature_equip_template', { CreatureID: '11000230', ID: '1', ItemID1: '1899', ItemID2: '0', ItemID3: '2552' });
    const copied: any = await api.entityTemplate('creature', 11000230);
    expect(copied.value.equipment).toEqual({ mainHand: 1899, offHand: 0, ranged: 2552 });
    const plain: any = await api.entityTemplate('gameobject', 1);
    expect(plain.value?.equipment).toBeUndefined();
  });
});
