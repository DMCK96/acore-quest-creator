import { describe, it, expect, vi } from 'vitest';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta, InvalidNameError, type ProjectQuest } from '../../src/main/project/project-file';
import { EMPTY_WORLD } from '../../src/core/world/layer';

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
    const doc = { ...defaultProjectMeta('Loaded', 'C:\\out'), quests: [q(60005, { x: 7 })], world: EMPTY_WORLD };
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


describe('ProjectSession: the world layer', () => {
  const layer = { spawns: [], routes: [{ pathId: 801, walkers: 1, original: [], current: [{ x: 1, y: 2, z: 3, rest: {} }] }], added: [] };

  it('starts empty, and a put is a change that toDocument and load carry', () => {
    const s = fresh();
    expect(s.world.get()).toEqual(EMPTY_WORLD);
    s.world.put(layer);
    expect([s.dirty(), s.revision()]).toEqual([true, 1]);
    expect(s.toDocument().world).toEqual(layer);
    const t = fresh();
    t.load(s.toDocument(), 'C:\\p.aqc', { dirty: false });
    expect(t.world.get()).toEqual(layer);
  });

  it('hands out copies, and reset empties it', () => {
    const s = fresh();
    s.world.put(layer);
    s.world.get().routes.length = 0;
    expect(s.world.get().routes).toHaveLength(1);
    s.reset(defaultProjectMeta('Untitled Project', 'C:\\out'));
    expect(s.world.get()).toEqual(EMPTY_WORLD);
  });
});

describe('the session\'s history', () => {
  it('records each kind of change as a step, and not quiet puts or exports', () => {
    const s = fresh();
    s.quests.put(q(60001));
    s.quests.put(q(60001, { x: 1 }), { quiet: true });
    s.quests.setPositions([{ questId: 60001, x: 40, y: 0 }]);
    s.world.put({ ...EMPTY_WORLD, added: [] , spawns: [] , routes: [{ pathId: 1, walkers: 1, original: [], current: [] }] });
    s.rename('Northshire');
    s.quests.markExported(60001, 'C:\\a.sql');
    s.quests.remove(60001);
    const kinds = s.history.list(() => ({ label: '', kind: 'project', where: null })).steps.length;
    expect(kinds).toBe(5);
  });

  it('undo and redo put the project back, leaving where it was exported alone', () => {
    const s = fresh();
    s.quests.put(q(60001, { aggregate: { ...q(60001).aggregate, values: { t: 'A' } } }));
    s.quests.put({ ...s.quests.get(60001)!, aggregate: { ...s.quests.get(60001)!.aggregate, values: { t: 'B' } } });
    s.quests.markExported(60001, 'C:\\a.sql');
    s.applyStep(s.history.undo()!, 'undo');
    expect(s.quests.get(60001)!.aggregate.values).toEqual({ t: 'A' });
    expect(s.quests.get(60001)!.lastExportPath).toBe('C:\\a.sql');
    s.applyStep(s.history.undo()!, 'undo');
    expect(s.quests.get(60001)).toBeUndefined();
    s.applyStep(s.history.redo()!, 'redo');
    expect(s.quests.get(60001)!.lastExportPath).toBeNull();
    s.applyStep(s.history.redo()!, 'redo');
    expect(s.quests.get(60001)!.aggregate.values).toEqual({ t: 'B' });
    expect(s.history.list(() => ({ label: '', kind: 'project', where: null })).steps).toHaveLength(2);
  });

  it('undoes a removal, positions, the world and the name', () => {
    const s = fresh();
    s.quests.put(q(60001));
    s.quests.setPositions([{ questId: 60001, x: 40, y: 2 }]);
    s.quests.remove(60001);
    s.applyStep(s.history.undo()!, 'undo');
    expect(s.quests.get(60001)).toMatchObject({ x: 40, y: 2 });
    s.applyStep(s.history.undo()!, 'undo');
    expect(s.quests.get(60001)).toMatchObject({ x: 0, y: 0 });
    s.rename('North');
    s.applyStep(s.history.undo()!, 'undo');
    expect(s.meta().name).toBe('Untitled Project');
    const layer = { ...EMPTY_WORLD, routes: [{ pathId: 1, walkers: 1, original: [], current: [] }] };
    s.world.put(layer);
    s.applyStep(s.history.undo()!, 'undo');
    expect(s.world.get()).toEqual(EMPTY_WORLD);
  });

  it('is clean again when undone back to the save, unsaved after a new edit from there, and an export keeps it unsaved', () => {
    const s = fresh();
    s.quests.put(q(60001));
    s.markSaved('C:\\p.aqc');
    s.rename('North');
    expect(s.dirty()).toBe(true);
    s.applyStep(s.history.undo()!, 'undo');
    expect(s.dirty()).toBe(false);
    s.quests.markExported(60001, 'C:\\a.sql');
    expect(s.dirty()).toBe(true);
    s.markSaved('C:\\p.aqc');
    expect(s.dirty()).toBe(false);
  });

  it('bumps the revision on undo, so the crash copy is written again', () => {
    const s = fresh();
    s.quests.put(q(60001));
    const r = s.revision();
    s.applyStep(s.history.undo()!, 'undo');
    expect(s.revision()).toBe(r + 1);
  });

  it('skips the parts it is told to', () => {
    const s = fresh();
    const t = s.history.begin('Two');
    s.quests.put(q(60001));
    s.rename('North');
    s.history.end(t);
    const step = s.history.undo()!;
    const nameIndex = step.parts.findIndex((p) => p.kind === 'name');
    s.applyStep(step, 'undo', new Set([nameIndex]));
    expect([s.quests.get(60001), s.meta().name]).toEqual([undefined, 'North']);
  });

  it('starts a fresh history on reset and load, and a recovered load is unsaved', () => {
    const s = fresh();
    s.quests.put(q(60001));
    s.reset(defaultProjectMeta('Next', 'C:\\out'));
    expect(s.history.undo()).toBeNull();
    s.quests.put(q(60002));
    s.load(s.toDocument(), 'C:\\p.aqc', { dirty: true });
    expect([s.history.undo(), s.dirty()]).toEqual([null, true]);
  });

  it('tells title listeners when an undo makes it clean or unsaved', () => {
    const s = fresh();
    const heard = vi.fn(); s.onChange(heard);
    s.quests.put(q(60001));
    heard.mockClear();
    s.applyStep(s.history.undo()!, 'undo');
    expect(heard).toHaveBeenCalled();
  });
});

describe('review findings: the session', () => {
  it('tells title listeners when a step made between begin and end leaves the project unsaved', () => {
    const s = fresh();
    s.markSaved('C:\p.aqc');
    const heard = vi.fn();
    s.onChange(heard);
    const t = s.history.begin('Move');
    s.world.put({ ...EMPTY_WORLD, routes: [{ pathId: 1, walkers: 1, original: [], current: [] }] });
    s.history.end(t);
    expect(s.dirty()).toBe(true);
    expect(heard).toHaveBeenCalled();
  });
});

describe('review minors: the session', () => {
  it('keeps where a quest was exported when its removal is undone', () => {
    const s = fresh();
    s.quests.put(q(60001));
    s.quests.markExported(60001, 'C:\out\a.sql');
    s.quests.remove(60001);
    s.applyStep(s.history.undo()!, 'undo');
    expect(s.quests.get(60001)!.lastExportPath).toBe('C:\out\a.sql');
  });
});
