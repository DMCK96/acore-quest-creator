// tests/core/patrol-edits.test.ts
import { describe, expect, it } from 'vitest';
import {
  addAction, addPoint, DEFAULT_POSE_WAIT, insertPoint, moveAction, movePoint,
  newPatrol, nextActionId, patrolOf, removeAction, setPatrol, updateAction, updatePoint,
} from '../../src/core/map/patrol';
import { ENTITIES_FIELD, newNpc, newSpawn, readEntities, writeEntities, type PointAction } from '../../src/core/entities/model';
import { POSES } from '../../src/core/patrol/poses';

const A = { x: 0, y: 0, z: 1 };
const B = { x: 10, y: 0, z: 2 };
const C = { x: 10, y: 10, z: 3 };
const route = () => addPoint(addPoint(newPatrol(9000), A), B);
const say: PointAction = { id: 'a1', afterSecs: 0, kind: 'say', lines: [{ text: 'Halt!', style: 'say' }], chance: 100 };

describe('patrol edits', () => {
  it('starts empty, walking, with its path id', () => {
    expect(newPatrol(9000)).toEqual({ pathId: 9000, startPace: 'walk', points: [] });
  });
  it('adds, inserts and moves points', () => {
    const p = insertPoint(route(), 1, C);
    expect(p.points.map((q) => q.z)).toEqual([1, 3, 2]);
    expect(p.points[1]).toEqual({ ...C, waitSecs: 0, facing: null, paceFromHere: null, actions: [] });
    expect(movePoint(p, 0, { x: 5, y: 5, z: 9 }).points[0]).toMatchObject({ x: 5, y: 5, z: 9 });
  });
  it('sets wait, pace and facing, and a facing on a point with no wait makes it wait', () => {
    const p = updatePoint(route(), 0, { paceFromHere: 'run' });
    expect(p.points[0]!.paceFromHere).toBe('run');
    const faced = updatePoint(p, 1, { facing: 1.5 });
    expect(faced.points[1]).toMatchObject({ facing: 1.5, waitSecs: DEFAULT_POSE_WAIT });
    const waited = updatePoint(updatePoint(p, 1, { waitSecs: 4 }), 1, { facing: 2 });
    expect(waited.points[1]!.waitSecs).toBe(4);
  });
  it('adds, replaces, reorders and removes actions', () => {
    let p = addAction(route(), 0, say);
    const wave: PointAction = { id: nextActionId(p.points[0]!), afterSecs: 2, kind: 'emote', emote: 3 };
    expect(wave.id).toBe('a2');
    p = addAction(p, 0, wave);
    expect(p.points[0]!.actions.map((a) => a.id)).toEqual(['a1', 'a2']);
    p = moveAction(p, 0, 'a2', -1);
    expect(p.points[0]!.actions.map((a) => a.id)).toEqual(['a2', 'a1']);
    p = updateAction(p, 0, { ...say, chance: 50 });
    expect(p.points[0]!.actions[1]).toMatchObject({ id: 'a1', chance: 50 });
    expect(removeAction(p, 0, 'a2').points[0]!.actions.map((a) => a.id)).toEqual(['a1']);
    expect(moveAction(p, 0, 'a2', -1)).toEqual(p);
  });
  it('makes a point with a pose wait', () => {
    const p = addAction(route(), 1, { id: 'a1', afterSecs: 0, kind: 'pose', emoteState: 68 });
    expect(p.points[1]!.waitSecs).toBe(DEFAULT_POSE_WAIT);
    expect(addAction(updatePoint(route(), 1, { waitSecs: 3 }), 1, { id: 'a1', afterSecs: 0, kind: 'pose', emoteState: 68 }).points[1]!.waitSecs).toBe(3);
  });
  it('reads and writes the patrol of one spawn', () => {
    const npc = { ...newNpc(12000001), spawns: [newSpawn(900), newSpawn(901)] };
    const values = { npcs: [npc], objects: [], items: [] };
    expect(patrolOf(values, 12000001, 900)).toBeNull();
    const after = setPatrol(values, 12000001, 901, route())!;
    expect(after.npcs[0]!.spawns[0]!.patrol).toBeNull();
    expect(patrolOf(after, 12000001, 901)).toEqual(route());
    expect(setPatrol(values, 12000001, 999, route())).toBeNull();
  });
  it('lists poses by name', () => {
    expect(POSES).toContainEqual({ value: 68, label: 'Kneel' });
    expect(POSES).toContainEqual({ value: 233, label: 'Mining' });
  });
});
