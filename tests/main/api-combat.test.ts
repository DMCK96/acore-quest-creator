import { describe, expect, it } from 'vitest';
import { createApi } from '../../src/main/api';
import { openStore } from '../../src/main/store/store';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta } from '../../src/main/project/project-file';
import type { ProjectController } from '../../src/main/project/controller';
import { ENTITIES_FIELD, newNpc, newSpawn, writeEntities } from '../../src/core/entities/model';
import { SCRIPTS_FIELD, writeScenes } from '../../src/core/scripts/model';
import { emptyFight, newAbility } from '../../src/core/combat/model';
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

describe('fights through the API', () => {
  it('exports a fighting NPC and a scene on it without collisions', async () => {
    const { api } = await setup();
    const opened: any = await api.newQuest();
    const aggregate = opened.value.aggregate;
    const q = aggregate.questId;
    aggregate.values['quest_template.LogTitle'] = 'Defeat Hela';
    const fight = { ...emptyFight(), abilities: [{ ...newAbility(emptyFight()), spellId: 116 }] };
    aggregate.values[ENTITIES_FIELD] = writeEntities({ npcs: [{ ...newNpc(11000240), name: 'Hela', displayId: 1234, spawns: [{ ...newSpawn(5300800), x: 5 }], fight }], objects: [] });
    aggregate.values[SCRIPTS_FIELD] = writeScenes([{ id: 's1', name: '', owner: { kind: 'creature', entry: 11000240 }, trigger: { kind: 'dies' }, gates: [], steps: [{ kind: 'eventCredit', group: false, waitMs: 0 }] }]);
    await api.updateQuest(aggregate);

    const out: any = await api.exportQuest(q);
    expect(out.ok).toBe(true);
    const sql: string = out.value.sql;
    expect(sql).toMatch(/INSERT INTO `creature_template` \(.*\) VALUES \(11000240,.*'SmartAI'/);
    expect(sql).toContain(`'AQC q${q} fight11000240: Casts spell 116 on its current target every 8–12 s (first after 2–4 s)'`);
    const smartInserts = sql.split('\n').filter((l) => l.startsWith('INSERT INTO `smart_scripts`'));
    const ids = smartInserts.map((l) => /VALUES \(11000240, 0, (\d+),/.exec(l)?.[1]).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(2);
  });

  it('blocks export on fight errors', async () => {
    const { api } = await setup();
    const opened: any = await api.newQuest();
    const aggregate = opened.value.aggregate;
    aggregate.values['quest_template.LogTitle'] = 'Defeat Hela';
    const fight = { ...emptyFight(), abilities: [newAbility(emptyFight())] };
    aggregate.values[ENTITIES_FIELD] = writeEntities({ npcs: [{ ...newNpc(11000241), name: 'Hela', displayId: 1234, spawns: [{ ...newSpawn(5300801), x: 5 }], fight }], objects: [] });
    await api.updateQuest(aggregate);
    const issues: any = await api.validate(aggregate.questId);
    expect(issues.value.map((i: any) => i.code)).toContain('FIGHT_NO_SPELL');
    const out: any = await api.exportQuest(aggregate.questId);
    expect(out.ok).toBe(false);
  });
});
