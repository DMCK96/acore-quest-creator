import { describe, expect, it } from 'vitest';
import { createApi } from '../../src/main/api';
import { openStore } from '../../src/main/store/store';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta } from '../../src/main/project/project-file';
import type { ProjectController } from '../../src/main/project/controller';
import { ENTITIES_FIELD, newNpc, writeEntities } from '../../src/core/entities/model';
import { SCRIPTS_FIELD, writeScenes } from '../../src/core/scripts/model';
import { forkDb } from '../helpers/fixtures';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };

describe('testCommands', () => {
  it('lists what a quest with a scene and a new NPC needs', async () => {
    const api = createApi({ store: openStore(':memory:', box), openWorldDb: async () => forkDb(), openDevDb: async () => { throw new Error('x'); },
      fs: { writeFile: async () => {}, ensureDir: async () => {}, listDir: async () => [] }, now: () => new Date(),
      session: createProjectSession(defaultProjectMeta('P', 'C:\\out')), projects: {} as ProjectController });
    const rec: any = await api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p' });
    await api.connect(rec.value.id);
    const opened: any = await api.newQuest();
    const aggregate = opened.value.aggregate;
    aggregate.values[ENTITIES_FIELD] = writeEntities({ npcs: [{ ...newNpc(12000001), name: 'Scout Hela', displayId: 1, spawns: [{ guid: 5, map: 0, x: 1, y: 2, z: 3, o: 0, respawnSecs: 60, wander: 0, patrol: null }] }], objects: [] });
    aggregate.values.creature_queststarter = [{ id: 12000001 }];
    aggregate.values[SCRIPTS_FIELD] = writeScenes([{ id: 's1', name: '', owner: { kind: 'creature', entry: 12000001 }, trigger: { kind: 'questAccepted' }, gates: [],
      steps: [{ kind: 'say', text: 'Go!', style: 'say', waitMs: 0 }] }]);
    await api.updateQuest(aggregate);
    const out: any = await api.testCommands(aggregate.questId);
    const reloads = out.value.reload.map((c: any) => c.command);
    expect(reloads).toContain('.reload smart_scripts');
    expect(reloads).toContain('.reload creature_text');
    expect(reloads).toContain('.reload creature_template 12000001');
    expect(out.value.restart.length).toBeGreaterThan(0);
    expect(out.value.go).toContainEqual({ command: '.go xyz 1 2 3 0', label: 'Scout Hela' });
    expect(out.value.quest[0].command).toBe(`.quest add ${aggregate.questId}`);
  });
});
