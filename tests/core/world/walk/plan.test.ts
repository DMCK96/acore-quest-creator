import { describe, expect, it } from 'vitest';
import { planKey, walkPlanOf } from '../../../../src/core/world/walk/plan';

const base = { x: 1, y: 2, z: 3, orientation: 0.5, wander: 0, path: null };

describe('walkPlanOf', () => {
  it('is a wander plan for a wander radius, with home and facing from the row', () => {
    expect(walkPlanOf({ ...base, wander: 6 })).toEqual({ type: 'wander', home: { x: 1, y: 2, z: 3 }, facing: 0.5, wander: 6, path: null });
  });

  it('is a path plan for a path, reading a database point\'s delay and move_type', () => {
    const plan = walkPlanOf({ ...base, path: [{ x: 5, y: 5, z: 3, carry: { delay: '2500', move_type: '1' } }, { x: 6, y: 6, z: 3, carry: { delay: '0', move_type: '0' } }] });
    expect(plan.type).toBe('path');
    expect(plan.path).toEqual([{ x: 5, y: 5, z: 3, delay: 2500, run: true }, { x: 6, y: 6, z: 3, delay: 0, run: false }]);
  });

  it('reads a quest NPC\'s patrol point wait and pace, a null pace keeping the pace it had', () => {
    const point = (waitSecs: number, paceFromHere: 'walk' | 'run' | null) => ({ x: 0, y: 0, z: 0, carry: { waitSecs, paceFromHere } });
    const plan = walkPlanOf({ ...base, path: [point(1.5, 'run'), point(0, null), point(0, 'walk'), point(0, null)] });
    expect(plan.path!.map((p) => [p.delay, p.run])).toEqual([[1500, true], [0, true], [0, false], [0, false]]);
  });

  it('counts a non-finite or negative wait as none (I2)', () => {
    const patrol = (waitSecs: number) => ({ x: 0, y: 0, z: 0, carry: { waitSecs, paceFromHere: null } });
    const plan = walkPlanOf({ ...base, path: [patrol(Number.NaN), patrol(Number.POSITIVE_INFINITY), patrol(-5)] });
    expect(plan.path!.map((p) => p.delay)).toEqual([0, 0, 0]);
    const db = walkPlanOf({ ...base, path: [{ x: 0, y: 0, z: 0, carry: { delay: '-500', move_type: '0' } }] });
    expect(db.path![0]!.delay).toBe(0);
  });

  it('treats points without usable carry as plain walking points', () => {
    const plan = walkPlanOf({ ...base, path: [{ x: 1, y: 1, z: 1 }, { x: 2, y: 2, z: 2, carry: 'junk' }, { x: 3, y: 3, z: 3, carry: { delay: 'x', move_type: null } }] });
    expect(plan.path!.map((p) => [p.delay, p.run])).toEqual([[0, false], [0, false], [0, false]]);
  });

  it('is idle for neither, and a wander circle wins nothing when there is a path', () => {
    expect(walkPlanOf(base).type).toBe('idle');
    expect(walkPlanOf({ ...base, wander: 4, path: [{ x: 9, y: 9, z: 3 }] }).type).toBe('path');
    expect(walkPlanOf({ ...base, path: [] }).type).toBe('idle');
  });
});

describe('planKey', () => {
  it('is equal for equal plans and differs when any point, delay, pace, radius or home changes', () => {
    const plan = walkPlanOf({ ...base, path: [{ x: 5, y: 5, z: 3, carry: { delay: '100', move_type: '0' } }] });
    expect(planKey(walkPlanOf({ ...base, path: [{ x: 5, y: 5, z: 3, carry: { delay: '100', move_type: '0' } }] }))).toBe(planKey(plan));
    for (const other of [
      walkPlanOf({ ...base, path: [{ x: 5.5, y: 5, z: 3, carry: { delay: '100', move_type: '0' } }] }),
      walkPlanOf({ ...base, path: [{ x: 5, y: 5, z: 3, carry: { delay: '200', move_type: '0' } }] }),
      walkPlanOf({ ...base, path: [{ x: 5, y: 5, z: 3, carry: { delay: '100', move_type: '1' } }] }),
      walkPlanOf({ ...base, x: 9, path: [{ x: 5, y: 5, z: 3, carry: { delay: '100', move_type: '0' } }] }),
      walkPlanOf({ ...base, wander: 3 }),
    ]) expect(planKey(other)).not.toBe(planKey(plan));
  });
});
