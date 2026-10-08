import { describe, expect, it, vi } from 'vitest';
import { MovementControl } from '../../src/renderer/world3d/scene/spawn/movement-control';
import { MovementDriver, type WalkTarget } from '../../src/renderer/world3d/scene/spawn/MovementDriver';
import type { Pose, WalkPlan } from '../../src/core/world/walk/types';

const plan = (x = 10): WalkPlan => ({ type: 'path', home: { x: 0, y: 0, z: 0 }, facing: 0, wander: 0, path: [{ x, y: 0, z: 0, delay: 0, run: false }] });
const target = () => { const poses: Pose[] = []; const t: WalkTarget = { apply: (p) => poses.push(p) }; return { t, poses, last: () => poses[poses.length - 1]! }; };

describe('MovementControl', () => {
  it('starts paused, plays, pauses, and counts resets without changing whether it plays', () => {
    const c = new MovementControl();
    expect([c.playing, c.epoch]).toEqual([false, 0]);
    c.play();
    c.reset();
    expect([c.playing, c.epoch]).toEqual([true, 1]);
    c.pause();
    expect(c.playing).toBe(false);
  });
});

describe('MovementDriver', () => {
  const setup = () => { const control = new MovementControl(); return { control, driver: new MovementDriver(control) }; };

  it('puts a new NPC at home, and does not move it while paused', () => {
    const { driver } = setup();
    const a = target();
    driver.track(1, plan(), 'k', a.t);
    expect(a.last()).toMatchObject({ x: 0, y: 0, gait: 'stand' });
    driver.tick(1000, () => 'move');
    expect(a.poses).toHaveLength(1);
  });

  it('moves NPCs that are to move while playing, in seconds of the step it is given', () => {
    const { control, driver } = setup();
    const a = target();
    driver.track(1, plan(), 'k', a.t);
    control.play();
    driver.tick(200, () => 'move');
    expect(a.last().x).toBeCloseTo(0.5);
    expect(a.last().gait).toBe('walk');
  });

  it('clamps one huge step', () => {
    const { control, driver } = setup();
    const a = target();
    driver.track(1, plan(1000), 'k', a.t);
    control.play();
    driver.tick(60000, () => 'move');
    expect(a.last().x).toBeCloseTo(0.625); // 250 ms at 2.5 yd/s
  });

  it('skips NPCs out of range and holds NPCs being worked on at home', () => {
    const { control, driver } = setup();
    const near = target(), far = target(), edited = target();
    driver.track(1, plan(), 'k', near.t);
    driver.track(2, plan(), 'k', far.t);
    driver.track(3, plan(), 'k', edited.t);
    control.play();
    driver.tick(200, (guid) => (guid === 1 ? 'move' : guid === 2 ? 'skip' : 'hold'));
    expect(near.last().x).toBeGreaterThan(0);
    expect(far.poses).toHaveLength(1);
    expect(edited.poses).toHaveLength(1);
    // moved, then picked: snaps home once, and stays
    driver.tick(200, () => 'move');
    expect(edited.last().x).toBeGreaterThan(0);
    driver.tick(200, (guid) => (guid === 3 ? 'hold' : 'move'));
    expect(edited.last()).toMatchObject({ x: 0, y: 0, gait: 'stand' });
    const count = edited.poses.length;
    driver.tick(200, (guid) => (guid === 3 ? 'hold' : 'move'));
    expect(edited.poses).toHaveLength(count);
  });

  it('pauses mid-walk: held where it is, standing, and carries on from there', () => {
    const { control, driver } = setup();
    const a = target();
    driver.track(1, plan(), 'k', a.t);
    control.play();
    driver.tick(1000, () => 'move');
    const at = a.last().x;
    control.pause();
    driver.tick(1000, () => 'move');
    expect(a.last()).toMatchObject({ x: at, gait: 'stand' });
    driver.tick(1000, () => 'move');
    const count = a.poses.length;
    driver.tick(1000, () => 'move');
    expect(a.poses).toHaveLength(count);
    control.play();
    driver.tick(200, () => 'move');
    expect(a.last().x).toBeCloseTo(at + 0.5);
  });

  it('resets everything to home on a reset, keeping whether it plays', () => {
    const { control, driver } = setup();
    const a = target();
    driver.track(1, plan(), 'k', a.t);
    control.play();
    driver.tick(1000, () => 'move');
    control.reset();
    driver.tick(0, () => 'move');
    expect(a.last()).toMatchObject({ x: 0, y: 0, gait: 'stand' });
    driver.tick(200, () => 'move');
    expect(a.last().x).toBeCloseTo(0.5);
    expect(control.playing).toBe(true);
  });

  it('keeps the walker when only the callbacks change, retargets it when the plan changes', () => {
    const { control, driver } = setup();
    const a = target(), b = target();
    driver.track(1, plan(), 'k', a.t);
    control.play();
    driver.tick(1000, () => 'move');
    driver.track(1, plan(), 'k', b.t);
    driver.tick(200, () => 'move');
    expect(b.last().x).toBeCloseTo(1.125); // the 1000 ms step was clamped to 250 ms
    expect(a.poses.length).toBe(2);
    driver.track(1, plan(20), 'k2', b.t);
    driver.tick(200, () => 'move');
    expect(b.last().x).toBeCloseTo(1.625);
  });

  it('hands the pose it has to a target it is tracked with again, standing while paused', () => {
    const { control, driver } = setup();
    const a = target(), b = target(), c = target();
    driver.track(1, plan(), 'k', a.t);
    control.play();
    driver.tick(200, () => 'move');
    driver.track(1, plan(), 'k', b.t);
    expect(b.last()).toMatchObject({ x: 0.5, gait: 'walk' });
    control.pause();
    driver.track(1, plan(20), 'k2', c.t);
    expect(c.last()).toMatchObject({ x: 0.5, gait: 'stand' });
  });

  it('forgets an NPC that is untracked, and an idle plan stays home', () => {
    const { control, driver } = setup();
    const a = target(), idle = target();
    driver.track(1, plan(), 'k', a.t);
    driver.track(2, { type: 'idle', home: { x: 5, y: 5, z: 0 }, facing: 1, wander: 0, path: null }, 'i', idle.t);
    control.play();
    driver.untrack(1);
    expect(driver.size).toBe(1);
    driver.tick(1000, () => 'move');
    expect(a.poses).toHaveLength(1);
    expect(idle.last()).toMatchObject({ x: 5, y: 5, gait: 'stand' });
  });

  it('does not call a target back for a walker retargeted to idle except to put it home', () => {
    const { control, driver } = setup();
    const a = target();
    driver.track(1, plan(), 'k', a.t);
    control.play();
    driver.tick(1000, () => 'move');
    driver.track(1, { type: 'idle', home: { x: 0, y: 0, z: 0 }, facing: 0, wander: 0, path: null }, 'i', a.t);
    expect(a.last()).toMatchObject({ x: 0, y: 0, gait: 'stand' });
    const spy = vi.fn(); a.t.apply = spy;
    driver.tick(1000, () => 'move');
    expect(spy).not.toHaveBeenCalled();
  });
});
