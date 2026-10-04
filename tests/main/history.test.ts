import { describe, it, expect, vi } from 'vitest';
import { createHistory, HISTORY_LIMIT } from '../../src/main/project/history';
import type { HistoryPart, QuestEdit } from '../../src/shared/history';
import { EMPTY_WORLD } from '../../src/core/world/layer';

const quest = (questId: number, values: Record<string, unknown>): QuestEdit => ({
  questId, isNew: true, aggregate: { questId, isNew: true, values, readOnly: [], sharedItems: {} } as QuestEdit['aggregate'],
  snapshot: null, fidelity: { ok: true }, x: 0, y: 0,
});
const title = (id: number, from: string, to: string): HistoryPart =>
  ({ kind: 'quest', questId: id, before: quest(id, { 'quest_template.LogTitle': from }), after: quest(id, { 'quest_template.LogTitle': to }) });
const level = (id: number, from: number, to: number): HistoryPart =>
  ({ kind: 'quest', questId: id, before: quest(id, { 'quest_template.QuestLevel': from }), after: quest(id, { 'quest_template.QuestLevel': to }) });
const moved = (x: number): HistoryPart => ({ kind: 'world', before: EMPTY_WORLD, after: { ...EMPTY_WORLD, spawns: [{ kind: 'creature', guid: 1, entry: 2, name: 'G', map: 0,
  original: { x: 0, y: 0, z: 0, orientation: 0, rotation: null }, current: { x, y: 0, z: 0, orientation: 0, rotation: null } }] } });
const clock = () => { let t = 0; const now = () => t; return { now, tick: (ms: number) => { t += ms; } }; };
const plain = () => ({ label: '', kind: 'project' as const, where: null });

describe('the project history', () => {
  it('makes each change outside a begin/end its own step, and undoes and redoes them in order', () => {
    const c = clock(); const h = createHistory({ now: c.now });
    h.record(title(1, '', 'A')); c.tick(5000);
    h.record(moved(5));
    expect(h.list(plain).steps).toHaveLength(2);
    expect(h.undo()!.parts[0]!.kind).toBe('world');
    expect(h.undo()!.parts[0]!.kind).toBe('quest');
    expect(h.undo()).toBeNull();
    expect(h.redo()!.parts[0]!.kind).toBe('quest');
    expect(h.current()).toBe(h.list(plain).steps[0]!.id);
  });

  it('drops what could be redone when a new change comes after an undo', () => {
    const h = createHistory();
    h.record(moved(1)); h.record(moved(2));
    h.undo();
    h.record(moved(3));
    expect(h.redo()).toBeNull();
    expect(h.list(plain).steps).toHaveLength(2);
  });

  it('joins every change between begin and end into one step, nested begins included, keeping the first before and last after', () => {
    const h = createHistory();
    const outer = h.begin('Paste 2 spawns');
    const inner = h.begin();
    h.record(moved(1));
    h.end(inner);
    h.record({ kind: 'world', before: moved(1).after as any, after: moved(9).after as any } as HistoryPart);
    h.record(title(1, '', 'A'));
    h.end(outer);
    const step = h.undo()!;
    expect(step.label).toBe('Paste 2 spawns');
    expect(step.parts.map((p) => p.kind).sort()).toEqual(['quest', 'world']);
    const world = step.parts.find((p) => p.kind === 'world')! as Extract<HistoryPart, { kind: 'world' }>;
    expect(world.before).toEqual(EMPTY_WORLD);
    expect(world.after.spawns[0]!.current.x).toBe(9);
  });

  it('drops a step whose parts end where they began', () => {
    const h = createHistory();
    const t = h.begin();
    h.record(moved(4));
    h.record({ kind: 'world', before: moved(4).after as any, after: EMPTY_WORLD } as HistoryPart);
    h.end(t);
    expect(h.list(plain).steps).toHaveLength(0);
  });

  it('merges typing in one field into one step, but not a different field, a pause, or a different quest', () => {
    const c = clock(); const h = createHistory({ now: c.now });
    h.record(title(1, '', 'K')); c.tick(500);
    h.record(title(1, 'K', 'Ko')); c.tick(500);
    h.record(title(1, 'Ko', 'Kob'));
    expect(h.list(plain).steps).toHaveLength(1);
    const merged = h.undo()!.parts[0] as Extract<HistoryPart, { kind: 'quest' }>;
    expect(merged.before!.aggregate.values['quest_template.LogTitle']).toBe('');
    expect(merged.after!.aggregate.values['quest_template.LogTitle']).toBe('Kob');
    h.redo();
    h.record(level(1, 1, 5));
    c.tick(3000); h.record(level(1, 5, 6));
    h.record(title(2, '', 'B'));
    expect(h.list(plain).steps).toHaveLength(4);
  });

  it('does not merge into an explicit step, across an undo, or across the saved point', () => {
    const c = clock(); const h = createHistory({ now: c.now });
    const t = h.begin('Named'); h.record(title(1, '', 'A')); h.end(t);
    h.record(title(1, 'A', 'AB'));
    expect(h.list(plain).steps).toHaveLength(2);
    h.markSaved();
    h.record(title(1, 'AB', 'ABC'));
    expect(h.list(plain).steps).toHaveLength(3);
  });

  it('keeps the saved point: at it after an undo back to it, not after a new change from there', () => {
    const h = createHistory();
    h.record(moved(1));
    h.markSaved();
    expect(h.atSaved()).toBe(true);
    h.record(moved(2));
    expect(h.atSaved()).toBe(false);
    h.undo();
    expect(h.atSaved()).toBe(true);
    h.undo();
    expect(h.atSaved()).toBe(false);
    h.record(moved(3));
    expect(h.atSaved()).toBe(false);
    expect(h.list(plain).saved).toBeNull();
  });

  it('starts at the saved point with no steps, and clear goes back there', () => {
    const h = createHistory();
    expect(h.atSaved()).toBe(true);
    h.record(moved(1));
    h.clear();
    expect([h.atSaved(), h.list(plain).steps.length, h.current()]).toEqual([true, 0, 0]);
  });

  it('jumps back over several steps newest first, and forward oldest first', () => {
    const h = createHistory();
    h.record(moved(1)); h.record(moved(2)); h.record(moved(3));
    const [a, b, c] = h.list(plain).steps.map((s) => s.id);
    const back = h.jump(a!);
    expect(back.direction).toBe('undo');
    expect(back.steps.map((s) => s.id)).toEqual([c, b]);
    expect(h.current()).toBe(a);
    const forward = h.jump(c!);
    expect(forward.steps.map((s) => s.id)).toEqual([b, c]);
    expect(h.jump(0).steps).toHaveLength(3);
    expect(h.current()).toBe(0);
  });

  it('keeps at most the limit, dropping the oldest, and loses a saved point that falls off', () => {
    const h = createHistory({ limit: 3 });
    h.record(moved(1)); h.markSaved();
    h.record(moved(2)); h.record(moved(3)); h.record(moved(4));
    expect(h.list(plain).steps).toHaveLength(3);
    expect(h.list(plain).saved).toBeNull();
    expect(HISTORY_LIMIT).toBe(300);
  });

  it('endAll closes an open step so the next change is a step of its own', () => {
    const h = createHistory();
    h.begin('Left open'); h.record(moved(1));
    h.endAll();
    h.record(moved(2));
    expect(h.list(plain).steps).toHaveLength(2);
  });

  it('tells listeners after each recorded step, undo, redo, jump, save and clear', () => {
    const h = createHistory(); const heard = vi.fn(); h.onChange(heard);
    h.record(moved(1)); h.undo(); h.redo(); h.jump(0); h.markSaved(); h.clear();
    expect(heard).toHaveBeenCalledTimes(6);
  });
});
