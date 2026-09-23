import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { createRecovery } from '../../src/main/project/recovery';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta, ProjectFileError, type ProjectQuest } from '../../src/main/project/project-file';
import { memFs } from '../helpers/mem-fs';

const DIR = join('C:\\ud', 'recovery');
const q = (questId: number): ProjectQuest => ({
  questId, isNew: true, aggregate: { questId, isNew: true, values: {}, readOnly: [], sharedItems: {} } as ProjectQuest['aggregate'],
  snapshot: null, fidelity: null, x: 0, y: 0, lastExportPath: null,
});
function setup() {
  const fs = memFs();
  const clock = { t: new Date('2026-09-23T14:02:00Z') };
  const rec = createRecovery({ dir: DIR, fs, now: () => clock.t });
  let n = 0;
  const session = createProjectSession(defaultProjectMeta('Northshire', 'C:\\out'), () => `s${++n}`);
  return { fs, rec, session, clock };
}

describe('recovery', () => {
  it('writes nothing while the project is clean', async () => {
    const { fs, rec, session } = setup();
    expect(await rec.tick(session)).toBe(false);
    expect(fs.files.size).toBe(0);
  });

  it('writes once per change while dirty', async () => {
    const { fs, rec, session } = setup();
    session.quests.put(q(60000));
    expect(await rec.tick(session)).toBe(true);
    expect(fs.files.has(join(DIR, 's1.aqc-recovery'))).toBe(true);
    expect(await rec.tick(session)).toBe(false);
    session.rename('Northshire 2');
    expect(await rec.tick(session)).toBe(true);
  });

  it('lists what it wrote and reads it back', async () => {
    const { rec, session } = setup();
    session.load({ ...defaultProjectMeta('Northshire', 'C:\\out'), quests: [q(60000)] }, 'C:\\w\\north.aqc', { dirty: true });
    await rec.tick(session);
    expect(await rec.list()).toEqual([
      { id: 's2', name: 'Northshire', recoveredFrom: 'C:\\w\\north.aqc', writtenAt: '2026-09-23T14:02:00.000Z', questCount: 1, damaged: false },
    ]);
    const back = await rec.read('s2');
    expect(back.recoveredFrom).toBe('C:\\w\\north.aqc');
    expect(back.doc).toEqual(session.toDocument());
  });

  it('clears a session\'s copy and writes again after the next change', async () => {
    const { fs, rec, session } = setup();
    session.quests.put(q(60000));
    await rec.tick(session);
    await rec.clear('s1');
    expect(fs.files.size).toBe(0);
    await rec.clear('s1');
    session.quests.put(q(60001));
    expect(await rec.tick(session)).toBe(true);
  });

  it('lists newest first, flags damaged files last and ignores other files', async () => {
    const { fs, rec, session, clock } = setup();
    session.quests.put(q(60000));
    await rec.tick(session);
    session.reset(defaultProjectMeta('Later', 'C:\\out'));
    session.quests.put(q(60001));
    clock.t = new Date('2026-09-23T15:00:00Z');
    await rec.tick(session);
    fs.files.set(join(DIR, 'bad.aqc-recovery'), 'garbage');
    fs.files.set(join(DIR, 'x.aqc-recovery.tmp'), 'half');
    const list = await rec.list();
    expect(list.map((e) => e.id)).toEqual(['s2', 's1', 'bad']);
    expect(list[2]).toEqual({ id: 'bad', name: '', recoveredFrom: null, writtenAt: '', questCount: 0, damaged: true });
    await expect(rec.read('bad')).rejects.toBeInstanceOf(ProjectFileError);
  });
});
