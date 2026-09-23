import { describe, it, expect, vi } from 'vitest';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta, InvalidNameError, type ProjectQuest } from '../../src/main/project/project-file';

const q = (questId: number, over: Partial<ProjectQuest> = {}): ProjectQuest => ({
  questId, isNew: false, aggregate: { questId, isNew: false, values: {}, readOnly: [], sharedItems: {} } as ProjectQuest['aggregate'],
  snapshot: null, fidelity: { ok: true }, x: 0, y: 0, lastExportPath: null, ...over,
});
const fresh = () => { let n = 0; return createProjectSession(defaultProjectMeta('Untitled Project', 'C:\\out'), () => `s${++n}`); };

describe('ProjectSession', () => {
  it('starts clean, untitled and empty', () => {
    const s = fresh();
    expect([s.id(), s.filePath(), s.dirty(), s.revision(), s.quests.list()]).toEqual(['s1', null, false, 0, []]);
    expect(s.meta().name).toBe('Untitled Project');
  });

  it('marks itself dirty on a put, but not on a quiet one', () => {
    const s = fresh();
    s.quests.put(q(60002), { quiet: true });
    expect([s.dirty(), s.revision()]).toEqual([false, 0]);
    s.quests.put(q(60001));
    expect([s.dirty(), s.revision()]).toEqual([true, 1]);
    expect(s.quests.list().map((x) => x.questId)).toEqual([60001, 60002]);
    expect(s.quests.usedQuestIds()).toEqual([60001, 60002]);
  });

  it('hands out copies, so a caller cannot change the project behind its back', () => {
    const s = fresh();
    s.quests.put(q(60001));
    s.quests.get(60001)!.x = 999;
    expect(s.quests.get(60001)!.x).toBe(0);
  });

  it('counts removals, real moves and exports as changes, and ignores no-ops', () => {
    const s = fresh();
    s.quests.put(q(60001));
    s.markSaved('C:\\p.aqc');
    s.quests.remove(12345);
    s.quests.setPositions([{ questId: 60001, x: 0, y: 0 }, { questId: 777, x: 5, y: 5 }]);
    expect(s.dirty()).toBe(false);
    s.quests.setPositions([{ questId: 60001, x: 40.5, y: -20 }]);
    expect(s.dirty()).toBe(true);
    expect(s.quests.get(60001)).toMatchObject({ x: 40.5, y: -20 });
    s.markSaved('C:\\p.aqc');
    s.quests.markExported(60001, 'C:\\out\\a.sql');
    expect([s.dirty(), s.quests.get(60001)!.lastExportPath]).toEqual([true, 'C:\\out\\a.sql']);
    s.markSaved('C:\\p.aqc');
    s.quests.remove(60001);
    expect([s.dirty(), s.quests.list()]).toEqual([true, []]);
  });

  it('renames with a trimmed name and refuses an empty one', () => {
    const s = fresh();
    s.rename('  Northshire  ');
    expect([s.meta().name, s.dirty()]).toEqual(['Northshire', true]);
    s.markSaved('C:\\p.aqc');
    s.rename('Northshire');
    expect(s.dirty()).toBe(false);
    expect(() => s.rename('   ')).toThrow(InvalidNameError);
    expect(s.meta().name).toBe('Northshire');
  });

  it('keeps the viewport without calling it an edit', () => {
    const s = fresh();
    s.setViewport({ x: -10, y: 5, zoom: 0.5 });
    expect([s.meta().viewport, s.dirty(), s.revision()]).toEqual([{ x: -10, y: 5, zoom: 0.5 }, false, 0]);
    expect(s.toDocument().viewport).toEqual({ x: -10, y: 5, zoom: 0.5 });
  });

  it('markSaved records the path and clears dirty without touching the revision', () => {
    const s = fresh();
    s.quests.put(q(60001));
    s.markSaved('C:\\p.aqc');
    expect([s.filePath(), s.dirty(), s.revision()]).toEqual(['C:\\p.aqc', false, 1]);
  });

  it('reset starts a new, empty, untitled project under a new id', () => {
    const s = fresh();
    s.quests.put(q(60001));
    s.markSaved('C:\\p.aqc');
    s.reset(defaultProjectMeta('Second', 'D:\\out'));
    expect([s.id(), s.filePath(), s.dirty(), s.quests.list(), s.meta().name, s.meta().outputDir]).toEqual(['s2', null, false, [], 'Second', 'D:\\out']);
  });

  it('load takes a document, a path and a dirty flag, under a new id', () => {
    const s = fresh();
    const doc = { ...defaultProjectMeta('Loaded', 'C:\\out'), quests: [q(60005, { x: 7 })] };
    s.load(doc, 'C:\\l.aqc', { dirty: true });
    expect([s.id(), s.filePath(), s.dirty(), s.meta().name]).toEqual(['s2', 'C:\\l.aqc', true, 'Loaded']);
    expect(s.toDocument()).toEqual(doc);
  });

  it('notifies listeners when what the title shows changes, until unsubscribed', () => {
    const s = fresh();
    const listener = vi.fn();
    const off = s.onChange(listener);
    s.quests.put(q(60001));
    s.quests.put(q(60002));
    expect(listener).toHaveBeenCalledTimes(1);
    s.rename('Other');
    s.markSaved('C:\\p.aqc');
    expect(listener).toHaveBeenCalledTimes(3);
    off();
    s.reset(defaultProjectMeta('X', 'C:\\out'));
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
