import { describe, expect, it } from 'vitest';
import { createWalker, kindOf } from '../../../../src/core/world/walk/walker';
import { seededRandom } from '../../../../src/core/world/walk/random';
import type { WalkPlan } from '../../../../src/core/world/walk/types';

const home = { x: 0, y: 0, z: 0 };
const point = (x: number, y: number, extra: object = {}) => ({ x, y, z: 0, delay: 0, run: false, ...extra });
const pathPlan = (path: ReturnType<typeof point>[]): WalkPlan => ({ type: 'path', home, facing: 1.5, wander: 0, path });
const wanderPlan = (wander: number, at = { x: 100, y: 200, z: 10 }): WalkPlan => ({ type: 'wander', home: at, facing: 0, wander, path: null });

describe('seededRandom', () => {
  it('repeats for a seed, differs between seeds, and stays in [0, 1)', () => {
    const a = seededRandom(7), b = seededRandom(7), c = seededRandom(8);
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect([c(), c(), c()]).not.toEqual(first);
    expect(first.every((v) => v >= 0 && v < 1)).toBe(true);
  });
});

describe('kindOf', () => {
  it('is idle for a path without points and a wander without radius', () => {
    expect(kindOf(pathPlan([]))).toBe('idle');
    expect(kindOf({ ...pathPlan([point(1, 1)]), path: null })).toBe('idle');
    expect(kindOf(wanderPlan(0))).toBe('idle');
    expect(kindOf(wanderPlan(3))).toBe('wander');
    expect(kindOf(pathPlan([point(1, 1)]))).toBe('path');
  });
});

describe('an idle walker', () => {
  it('stands at home, facing its stored way, however long it runs', () => {
    const w = createWalker({ type: 'idle', home, facing: 2, wander: 0, path: null }, 1);
    expect(w.advance(60000)).toEqual({ x: 0, y: 0, z: 0, heading: 2, gait: 'stand' });
  });
});

describe('a path walker', () => {
  const plan = () => pathPlan([point(10, 0), point(10, 10, { delay: 2000 })]);

  it('starts at home facing its stored way, standing', () => {
    expect(createWalker(plan(), 1).pose()).toEqual({ x: 0, y: 0, z: 0, heading: 1.5, gait: 'stand' });
  });

  it('walks the first leg at walk speed, facing where it goes', () => {
    const w = createWalker(plan(), 1);
    const pose = w.advance(2000);
    expect(pose.x).toBeCloseTo(5);
    expect(pose.y).toBeCloseTo(0);
    expect(pose.heading).toBeCloseTo(0);
    expect(pose.gait).toBe('walk');
  });

  it('turns at the point and walks the next leg (+y is a quarter turn counter-clockwise)', () => {
    const w = createWalker(plan(), 1);
    const pose = w.advance(4000 + 2000);
    expect(pose.x).toBeCloseTo(10);
    expect(pose.y).toBeCloseTo(5);
    expect(pose.heading).toBeCloseTo(Math.PI / 2);
  });

  it('stands for a point\'s delay, then loops back to the first point and on', () => {
    const w = createWalker(plan(), 1);
    // home -> A is 4 s, A -> B is 4 s: at B with a 2 s wait
    expect(w.advance(8000)).toMatchObject({ x: 10, y: 10 });
    expect(w.advance(1000)).toMatchObject({ x: 10, y: 10, gait: 'stand' });
    // 1 s of wait left, then B -> A (p0) at 2.5 yd/s: 2 s in is 5 yd along
    const pose = w.advance(1000 + 2000);
    expect(pose.x).toBeCloseTo(10);
    expect(pose.y).toBeCloseTo(5);
    expect(pose.gait).toBe('walk');
    // all the way back to A, then A -> B again (no wait at A)
    expect(w.advance(2000 + 2000)).toMatchObject({ x: 10, y: 5 });
  });

  it('runs a leg that leaves a point marked run, and interpolates z', () => {
    const w = createWalker(pathPlan([point(10, 0, { run: true }), { x: 10, y: 14, z: 7, delay: 0, run: false }]), 1);
    const pose = w.advance(4000 + 1000);
    expect(pose.gait).toBe('run');
    expect(pose.y).toBeCloseTo(7);
    expect(pose.z).toBeCloseTo(3.5);
  });

  it('crosses several legs inside one long step', () => {
    const w = createWalker(pathPlan([point(10, 0), point(10, 10)]), 1);
    // 4 s + 4 s + 4 s (B -> A) + 2 s (A -> B, 5 yd)
    const pose = w.advance(14000);
    expect(pose.x).toBeCloseTo(10);
    expect(pose.y).toBeCloseTo(5);
  });

  it('stands at a lone point and ignores zero-length legs', () => {
    const lone = createWalker(pathPlan([point(10, 0, { delay: 1000 })]), 1);
    expect(lone.advance(60000)).toMatchObject({ x: 10, y: 0, gait: 'stand' });
    const twins = createWalker(pathPlan([point(10, 0), point(10, 0)]), 1);
    const pose = twins.advance(60000);
    expect(Number.isFinite(pose.x) && Number.isFinite(pose.y)).toBe(true);
    expect(pose).toMatchObject({ x: 10, y: 0 });
  });

  it('ignores a negative or non-finite step', () => {
    const w = createWalker(plan(), 1);
    expect(w.advance(-500)).toMatchObject({ x: 0, y: 0 });
    expect(w.advance(Number.NaN)).toMatchObject({ x: 0, y: 0 });
  });
});

describe('a wander walker', () => {
  it('stays within its radius of home over a long run and actually moves', () => {
    const w = createWalker(wanderPlan(5), 3);
    let moved = false;
    for (let i = 0; i < 2000; i++) {
      const p = w.advance(100);
      expect(Math.hypot(p.x - 100, p.y - 200)).toBeLessThanOrEqual(5 + 1e-6);
      if (p.gait === 'walk') moved = true;
    }
    expect(moved).toBe(true);
  });

  it('is deterministic for a seed and differs between seeds', () => {
    const run = (seed: number) => { const w = createWalker(wanderPlan(8), seed); for (let i = 0; i < 300; i++) w.advance(100); return w.pose(); };
    expect(run(5)).toEqual(run(5));
    expect(run(5)).not.toEqual(run(6));
  });

  it('takes its height from the ground callback, and keeps the last height where there is none', () => {
    const w = createWalker(wanderPlan(8), 2);
    let sawGround = false;
    for (let i = 0; i < 600; i++) {
      const p = w.advance(100, (x) => x / 10);
      if (p.gait === 'walk') { expect(p.z).toBeCloseTo(p.x / 10); sawGround = true; }
    }
    expect(sawGround).toBe(true);
    const before = w.pose().z;
    expect(w.advance(100, () => null).z).toBe(before);
  });
});

describe('reset', () => {
  it('goes back to the start, then repeats the run exactly', () => {
    const w = createWalker(wanderPlan(6), 4);
    const first = (() => { for (let i = 0; i < 200; i++) w.advance(100); return w.pose(); })();
    w.reset();
    expect(w.pose()).toMatchObject({ x: 100, y: 200, gait: 'stand' });
    for (let i = 0; i < 200; i++) w.advance(100);
    expect(w.pose()).toEqual(first);
  });
});

describe('retarget', () => {
  it('keeps a path walker where it is when a point is dragged, and walks to the moved point', () => {
    const w = createWalker(pathPlan([point(10, 0), point(10, 10)]), 1);
    w.advance(2000); // 5 yd along the first leg
    w.retarget(pathPlan([point(10, 4), point(10, 10)]));
    expect(w.pose()).toMatchObject({ x: 5, y: 0 });
    const pose = w.advance(60000);
    expect(Number.isFinite(pose.x) && Number.isFinite(pose.y)).toBe(true);
    const reached = createWalker(pathPlan([point(10, 4)]), 1);
    reached.advance(60000);
    expect(reached.pose()).toMatchObject({ x: 10, y: 4 });
  });

  it('heads for the nearest valid point when its target point was deleted', () => {
    const w = createWalker(pathPlan([point(10, 0), point(10, 10), point(0, 10)]), 1);
    w.advance(10000); // on the way to the third point
    w.retarget(pathPlan([point(10, 0), point(10, 10)]));
    const pose = w.advance(100);
    expect(Number.isFinite(pose.x) && Number.isFinite(pose.y)).toBe(true);
  });

  it('shortens a wait that the edit shortened', () => {
    const w = createWalker(pathPlan([point(10, 0, { delay: 10000 })]), 1);
    w.advance(5000); // 1 s into a 10 s wait
    w.retarget(pathPlan([point(10, 0, { delay: 1000 })]));
    // the lone point has nowhere to go, so it just stands; no throw, still at the point
    expect(w.advance(5000)).toMatchObject({ x: 10, y: 0, gait: 'stand' });
  });

  it('restarts at home when the kind changes (a wanderer given a path, a path taken away)', () => {
    const w = createWalker(wanderPlan(5), 1);
    for (let i = 0; i < 300; i++) w.advance(100);
    w.retarget({ type: 'path', home: { x: 100, y: 200, z: 10 }, facing: 0, wander: 0, path: [point(110, 200)] });
    expect(w.pose()).toMatchObject({ x: 100, y: 200, gait: 'stand' });
    w.advance(1000);
    w.retarget({ type: 'idle', home: { x: 100, y: 200, z: 10 }, facing: 0, wander: 0, path: null });
    expect(w.pose()).toMatchObject({ x: 100, y: 200, gait: 'stand' });
  });

  it('keeps a wanderer where it is on a new radius, and walks it back in when the radius shrank below it', () => {
    const w = createWalker(wanderPlan(20), 9);
    let far = false;
    for (let i = 0; i < 3000 && !far; i++) far = Math.hypot(w.advance(100).x - 100, w.pose().y - 200) > 4;
    expect(far).toBe(true);
    const at = w.pose();
    w.retarget(wanderPlan(1));
    expect(w.pose()).toMatchObject({ x: at.x, y: at.y });
    for (let i = 0; i < 200; i++) w.advance(100);
    const p = w.pose();
    expect(Math.hypot(p.x - 100, p.y - 200)).toBeLessThanOrEqual(1 + 1e-6);
  });
});
