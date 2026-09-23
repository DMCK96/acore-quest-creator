import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { createProjectController, suggestedFileName, type Dialogs, type UnsavedAnswer } from '../../src/main/project/controller';
import { createProjectSession } from '../../src/main/project/session';
import { createRecovery } from '../../src/main/project/recovery';
import { defaultProjectMeta, parseProject, serializeProject, InvalidNameError, ProjectFileError, SaveFailedError, type ProjectQuest } from '../../src/main/project/project-file';
import { openStore, type SecretBox } from '../../src/main/store/store';
import { memFs, type MemFs } from '../helpers/mem-fs';

const box: SecretBox = { encrypt: (s) => Uint8Array.from(Buffer.from(s)), decrypt: (b) => Buffer.from(b).toString() };
const RDIR = join('C:\\ud', 'recovery');
const P = join('C:\\work', 'north.aqc');
const P2 = join('C:\\work', 'north-copy.aqc');
const now = () => new Date('2026-09-23T14:02:00Z');
const q = (questId: number): ProjectQuest => ({
  questId, isNew: true, aggregate: { questId, isNew: true, values: {}, readOnly: [], sharedItems: {} } as ProjectQuest['aggregate'],
  snapshot: null, fidelity: null, x: 0, y: 0, lastExportPath: null,
});
const recoveryFiles = (fs: MemFs) => [...fs.files.keys()].filter((k) => k.endsWith('.aqc-recovery'));

function setup(answers: { save?: (string | null)[]; open?: (string | null)[]; unsaved?: UnsavedAnswer[] } = {}, fs: MemFs = memFs()) {
  let n = 0;
  const session = createProjectSession(defaultProjectMeta('Untitled Project', 'C:\\out'), () => `s${fs.files.size}-${++n}`);
  const recovery = createRecovery({ dir: RDIR, fs, now });
  const store = openStore(':memory:', box);
  const asked = { save: [] as string[], open: 0, unsaved: [] as string[] };
  const dialogs: Dialogs = {
    showSave: async (s) => { asked.save.push(s); return answers.save?.shift() ?? null; },
    showOpen: async () => { asked.open++; return answers.open?.shift() ?? null; },
    confirmUnsaved: async (name) => { asked.unsaved.push(name); return answers.unsaved?.shift() ?? 'cancel'; },
  };
  const c = createProjectController({ session, fs, dialogs, recovery, recent: store.recent, defaultOutputDir: 'C:\\out', now });
  return { c, fs, session, recovery, store, asked };
}

describe('suggestedFileName', () => {
  it('replaces characters Windows forbids and adds the extension', () => {
    expect(suggestedFileName('Wolves: part 2/3')).toBe('Wolves_ part 2_3.aqc');
    expect(suggestedFileName('a<b>c"d\\e|f?g*h')).toBe('a_b_c_d_e_f_g_h.aqc');
    expect(suggestedFileName('  ')).toBe('Untitled Project.aqc');
  });
});

describe('ProjectController', () => {
  it('reports the state of a fresh project', () => {
    const { c } = setup();
    expect(c.state()).toEqual({ name: 'Untitled Project', filePath: null, dirty: false, idRangeStart: 60000, idRangeEnd: 99999, outputDir: 'C:\\out', viewport: { x: 0, y: 0, zoom: 1 } });
  });

  it('Save As writes the project, remembers it and drops the recovery copy', async () => {
    const { c, fs, session, recovery, store, asked } = setup({ save: [P] });
    session.quests.put(q(60000));
    await recovery.tick(session);
    expect(recoveryFiles(fs)).toHaveLength(1);
    expect(await c.saveAs()).toEqual({ done: true });
    expect(asked.save).toEqual(['Untitled Project.aqc']);
    expect(parseProject(fs.files.get(P)!).quests.map((x) => x.questId)).toEqual([60000]);
    expect(c.state()).toMatchObject({ filePath: P, dirty: false });
    expect(store.recent.list()).toEqual([{ path: P, name: 'Untitled Project', openedAt: now().toISOString() }]);
    expect(recoveryFiles(fs)).toEqual([]);
  });

  it('Save As cancelled writes nothing and keeps the changes', async () => {
    const { c, fs, session } = setup({ save: [null] });
    session.quests.put(q(60000));
    expect(await c.saveAs()).toEqual({ done: false });
    expect(fs.files.size).toBe(0);
    expect(c.state().dirty).toBe(true);
  });

  it('Save on an untitled project asks where; on a saved one it does not', async () => {
    const { c, fs, session, asked } = setup({ save: [P] });
    session.quests.put(q(60000));
    await c.save();
    session.quests.put(q(60001));
    expect(await c.save()).toEqual({ done: true });
    expect(asked.save).toHaveLength(1);
    expect(parseProject(fs.files.get(P)!).quests).toHaveLength(2);
  });

  it('after Save As to a new path, Save writes there and leaves the old file alone', async () => {
    const { c, fs, session } = setup({ save: [P, P2] });
    session.quests.put(q(60000));
    await c.save();
    const before = fs.files.get(P);
    await c.saveAs();
    session.quests.put(q(60001));
    await c.save();
    expect(fs.files.get(P)).toBe(before);
    expect(parseProject(fs.files.get(P2)!).quests).toHaveLength(2);
    expect(c.state().filePath).toBe(P2);
  });

  it('a failed save keeps the changes and the recovery copy', async () => {
    const { c, fs, session, recovery } = setup({ save: [P] });
    session.quests.put(q(60000));
    await recovery.tick(session);
    fs.failNext.write = new Error('EACCES: permission denied');
    const err = await c.saveAs().catch((e) => e);
    expect(err).toBeInstanceOf(SaveFailedError);
    expect(err.message).toMatch(/EACCES/);
    expect(c.state().dirty).toBe(true);
    expect(recoveryFiles(fs)).toHaveLength(1);
  });

  describe('unsaved changes', () => {
    it('does not ask when there is nothing to lose', async () => {
      const { c, asked } = setup();
      expect(await c.settleUnsaved()).toBe(true);
      expect(asked.unsaved).toEqual([]);
    });
    it('Cancel stops, Discard proceeds, Save saves first', async () => {
      const a = setup({ unsaved: ['cancel'] }); a.session.quests.put(q(1));
      expect(await a.c.settleUnsaved()).toBe(false);
      expect(a.asked.unsaved).toEqual(['Untitled Project']);
      const b = setup({ unsaved: ['discard'] }); b.session.quests.put(q(1));
      expect(await b.c.settleUnsaved()).toBe(true);
      const d = setup({ unsaved: ['save'], save: [P] }); d.session.quests.put(q(1));
      expect(await d.c.settleUnsaved()).toBe(true);
      expect(d.fs.files.has(P)).toBe(true);
    });
    it('Save that is then cancelled in the file dialog cancels everything', async () => {
      const { c, session } = setup({ unsaved: ['save'], save: [null] });
      session.quests.put(q(1));
      expect(await c.settleUnsaved()).toBe(false);
      expect(c.state().dirty).toBe(true);
    });
  });

  it('New starts an empty project under the given name, with default settings', async () => {
    const { c, session } = setup();
    session.setViewport({ x: 9, y: 9, zoom: 2 });
    expect(await c.newProject('  Northshire  ')).toEqual({ done: true });
    expect(c.state()).toEqual({ name: 'Northshire', filePath: null, dirty: false, idRangeStart: 60000, idRangeEnd: 99999, outputDir: 'C:\\out', viewport: { x: 0, y: 0, zoom: 1 } });
    expect(session.quests.list()).toEqual([]);
  });

  it('New refuses an empty name before asking anything', async () => {
    const { c, session, asked } = setup();
    session.quests.put(q(1));
    await expect(c.newProject('  ')).rejects.toBeInstanceOf(InvalidNameError);
    expect(asked.unsaved).toEqual([]);
    expect(session.quests.list()).toHaveLength(1);
  });

  it('New cancelled at the unsaved prompt changes nothing', async () => {
    const { c, session } = setup({ unsaved: ['cancel'] });
    session.quests.put(q(1));
    expect(await c.newProject('Other')).toEqual({ done: false });
    expect(c.state().name).toBe('Untitled Project');
    expect(session.quests.list()).toHaveLength(1);
  });

  it('New after Discard drops the old recovery copy', async () => {
    const { c, fs, session, recovery } = setup({ unsaved: ['discard'] });
    session.quests.put(q(1));
    await recovery.tick(session);
    await c.newProject('Other');
    expect(recoveryFiles(fs)).toEqual([]);
  });

  it('Open loads a file, from a dialog or a given path, and remembers it', async () => {
    const fs = memFs({ [P]: serializeProject({ ...defaultProjectMeta('North', 'D:\\sql'), quests: [q(60005)] }) });
    const { c, session, store, asked } = setup({ open: [P] }, fs);
    expect(await c.open()).toEqual({ done: true });
    expect(asked.open).toBe(1);
    expect(c.state()).toMatchObject({ name: 'North', filePath: P, dirty: false, outputDir: 'D:\\sql' });
    expect(session.quests.list().map((x) => x.questId)).toEqual([60005]);
    expect(store.recent.list()[0]).toMatchObject({ path: P, name: 'North' });
    expect(await c.open(P)).toEqual({ done: true });
    expect(asked.open).toBe(1);
  });

  it('Open with the dialog cancelled does nothing', async () => {
    const { c } = setup({ open: [null] });
    expect(await c.open()).toEqual({ done: false });
  });

  it('opening the file that is already open, with unsaved changes, still asks first', async () => {
    const fs = memFs({ [P]: serializeProject({ ...defaultProjectMeta('North', 'C:\\out'), quests: [] }) });
    const { c, session, asked } = setup({ unsaved: ['cancel'] }, fs);
    await c.open(P);
    session.quests.put(q(1));
    expect(await c.open(P)).toEqual({ done: false });
    expect(asked.unsaved).toEqual(['North']);
    expect(session.quests.list()).toHaveLength(1);
  });

  it('a failed open leaves the current project and its recovery copy alone', async () => {
    const fs = memFs({ [P]: 'not json' });
    const { c, session, recovery } = setup({ unsaved: ['discard', 'discard'] }, fs);
    session.quests.put(q(1));
    await recovery.tick(session);
    const id = session.id();
    await expect(c.open(P)).rejects.toMatchObject({ name: 'ProjectFileError', reason: 'not-a-project' });
    await expect(c.open(join('C:\\work', 'gone.aqc'))).rejects.toMatchObject({ name: 'ProjectFileError', reason: 'unreadable' });
    expect([session.id(), session.dirty(), session.quests.list().length]).toEqual([id, true, 1]);
    expect(recoveryFiles(fs)).toHaveLength(1);
  });

  it('a recent project whose file is gone is flagged, and a failed open keeps it listed', async () => {
    const fs = memFs({ [P]: serializeProject({ ...defaultProjectMeta('North', 'C:\\out'), quests: [] }) });
    const { c, store } = setup({}, fs);
    await c.open(P);
    fs.files.delete(P);
    expect(await c.recent()).toEqual([{ path: P, name: 'North', openedAt: now().toISOString(), exists: false }]);
    await expect(c.open(P)).rejects.toBeInstanceOf(ProjectFileError);
    expect(store.recent.list()).toHaveLength(1);
    c.forgetRecent(P);
    expect(await c.recent()).toEqual([]);
  });

  it('rename marks the project changed', () => {
    const { c } = setup();
    c.rename('Renamed');
    expect(c.state()).toMatchObject({ name: 'Renamed', dirty: true });
  });

  it('restores unsaved work left by a crash, as unsaved, against its original file', async () => {
    const fs = memFs();
    const before = setup({}, fs);
    before.session.load({ ...defaultProjectMeta('North', 'C:\\out'), quests: [q(60000)] }, P, { dirty: true });
    await before.recovery.tick(before.session);
    const after = setup({}, fs);
    const [entry] = await after.c.recoveries();
    expect(entry).toMatchObject({ name: 'North', recoveredFrom: P, questCount: 1, damaged: false });
    await after.c.restoreRecovery(entry.id);
    expect(after.c.state()).toMatchObject({ name: 'North', filePath: P, dirty: true });
    expect(after.session.quests.list().map((x) => x.questId)).toEqual([60000]);
    expect(recoveryFiles(fs)).toEqual([]);
  });

  it('discards a recovery copy, and clears the current one on a clean quit', async () => {
    const fs = memFs();
    const a = setup({}, fs);
    a.session.quests.put(q(1));
    await a.recovery.tick(a.session);
    await a.c.discardOnQuit();
    expect(recoveryFiles(fs)).toEqual([]);
    a.session.quests.put(q(2));
    await a.recovery.tick(a.session);
    const [entry] = await a.c.recoveries();
    await a.c.discardRecovery(entry.id);
    expect(recoveryFiles(fs)).toEqual([]);
  });
});
