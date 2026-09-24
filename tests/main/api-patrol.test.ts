// tests/main/api-patrol.test.ts
import { describe, expect, it } from 'vitest';
import { createApi } from '../../src/main/api';
import { openStore } from '../../src/main/store/store';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta } from '../../src/main/project/project-file';
import type { ProjectController } from '../../src/main/project/controller';
import { ENTITIES_FIELD, newNpc, newSpawn, writeEntities } from '../../src/core/entities/model';
import { addPoint, newPatrol } from '../../src/core/map/patrol';
import { forkDb } from '../helpers/fixtures';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };

async function setup() {
  const db = forkDb();
  const api = createApi({ store: openStore(':memory:', box), openWorldDb: async () => db, openDevDb: async () => { throw new Error('x'); },
    fs: { writeFile: async () => {}, ensureDir: async () => {}, listDir: async () => [] }, now: () => new Date('2026-09-24T00:00:00Z'),
    session: createProjectSession(defaultProjectMeta('P', 'C:\\out')), projects: {} as ProjectController });
  const rec: any = await api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p' });
  await api.connect(rec.value.id);
  return { api, db };
}

describe('patrols through the API', () => {
  it('exports a new NPC that walks its route, and previews the rows', async () => {
    const { api } = await setup();
    const opened: any = await api.newQuest();
    const aggregate = opened.value.aggregate;
    aggregate.values['quest_template.LogTitle'] = 'Walk the walls';
    const patrol = addPoint(addPoint(newPatrol(53007010), { x: 1, y: 2, z: 3 }), { x: 4, y: 5, z: 6 });
    aggregate.values[ENTITIES_FIELD] = writeEntities({ npcs: [{ ...newNpc(11000240), name: 'Walker', displayId: 1, spawns: [{ ...newSpawn(5300701), patrol }] }], objects: [] });
    await api.updateQuest(aggregate);
    const out: any = await api.exportQuest(aggregate.questId);
    expect(out.ok).toBe(true);
    expect(out.value.sql).toMatch(/INSERT INTO `creature_addon` .*VALUES \(5300701, 53007010/);
    expect(out.value.sql).toMatch(/INSERT INTO `waypoint_data`/);
    expect(out.value.sql.indexOf('INSERT INTO `creature`')).toBeLessThan(out.value.sql.indexOf('INSERT INTO `creature_addon`'));
    const preview: any = await api.previewChanges(aggregate.questId);
    expect(preview.value.some((d: any) => d.table === 'waypoint_data')).toBe(true);
    expect(preview.value.some((d: any) => d.table === 'creature_addon')).toBe(true);
  });
});
