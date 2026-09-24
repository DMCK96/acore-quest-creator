import { describe, expect, it } from 'vitest';
import { createApi } from '../../src/main/api';
import { openStore } from '../../src/main/store/store';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta } from '../../src/main/project/project-file';
import type { ProjectController } from '../../src/main/project/controller';
import { SCRIPTS_FIELD, writeScenes, type QuestScene } from '../../src/core/scripts/model';
import { SCRIPT_TABLES } from '../../src/core/scripts/context';
import { forkDb } from '../helpers/fixtures';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };
const scene: QuestScene = {
  id: 's1', name: '', owner: { kind: 'creature', entry: 299 }, trigger: { kind: 'dies' }, gates: [],
  steps: [{ kind: 'credit', objective: 1, group: false, waitMs: 0 }],
};

async function setup() {
  const db = forkDb();
  for (const t of SCRIPT_TABLES) if ((await db.columns(t)).length === 0) throw new Error(`fixture lacks ${t}`);
  db.insert('creature_template', { entry: '299', name: 'Wolf', npcflag: '0', gossip_menu_id: '0', AIName: '', ScriptName: '' });
  db.insert('smart_scripts', { entryorguid: '299', source_type: '0', id: '0', link: '0', event_type: '4', action_type: '11', comment: 'Wolf - On Aggro - Cast' });
  const files = new Map<string, string>();
  const api = createApi({ store: openStore(':memory:', box), openWorldDb: async () => db, openDevDb: async () => { throw new Error('x'); },
    fs: { writeFile: async (p, t) => { files.set(p, t); }, ensureDir: async () => {}, listDir: async () => [] },
    now: () => new Date('2026-09-24T00:00:00Z'), session: createProjectSession(defaultProjectMeta('P', 'C:\\out')), projects: {} as ProjectController });
  const rec: any = await api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p' });
  await api.connect(rec.value.id);
  return { api, db, files };
}

describe('scripts through the API', () => {
  it('exports scene rows with the quest and previews them', async () => {
    const { api, files } = await setup();
    const opened: any = await api.newQuest();
    const aggregate = opened.value.aggregate;
    aggregate.values['quest_template.LogTitle'] = 'Wolves';
    aggregate.values['quest_template.RequiredNpcOrGo'] = [{ target: { target: 'creature', id: 299 }, count: 5 }];
    aggregate.values[SCRIPTS_FIELD] = writeScenes([scene]);
    await api.updateQuest(aggregate);
    const preview: any = await api.previewChanges(aggregate.questId);
    expect(preview.value.some((d: any) => d.table === 'smart_scripts')).toBe(true);
    const out: any = await api.exportQuest(aggregate.questId);
    expect(out.ok).toBe(true);
    expect(out.value.sql).toMatch(/INSERT INTO `smart_scripts`.*'AQC q\d+ s1: When it dies/);
    expect(out.value.sql).toContain("SET `AIName` = 'SmartAI'");
    expect([...files.values()][0]).toBe(out.value.sql);
  });

  it('blocks export on scene errors and lists foreign scripts', async () => {
    const { api } = await setup();
    const opened: any = await api.newQuest();
    const aggregate = opened.value.aggregate;
    aggregate.values[SCRIPTS_FIELD] = writeScenes([{ ...scene, steps: [{ kind: 'credit', objective: 3, group: false, waitMs: 0 }] }]);
    await api.updateQuest(aggregate);
    const issues: any = await api.validate(aggregate.questId);
    expect(issues.value.map((i: any) => i.code)).toContain('SCENE_CREDIT_EMPTY');
    const out: any = await api.exportQuest(aggregate.questId);
    expect(out.ok).toBe(false);
    const info: any = await api.questScripts(aggregate.questId);
    expect(info.value.foreign).toEqual([{ ownerKind: 'creature', entry: 299, trigger: 'when it enters combat', steps: ['cast a spell'], combat: true }]);
  });
});
