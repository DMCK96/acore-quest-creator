export type Vec3 = { x: number; y: number; z: number };

export type Gait = 'stand' | 'walk' | 'run';

/** One stop of a path; `delay` is the wait there in ms, `run` is how the leg leaving it is travelled. */
export type WalkPoint = Vec3 & { delay: number; run: boolean };

export type WalkPlan = {
  type: 'idle' | 'wander' | 'path';
  home: Vec3;
  facing: number;
  wander: number;
  path: WalkPoint[] | null;
};

export type Pose = Vec3 & { heading: number; gait: Gait };

/** The highest ground at (x, y) at or below `fromZ`, no more than `distance` below it; null where there is none. */
export type GroundFn = (x: number, y: number, fromZ: number, distance: number) => number | null;

/** Poses are the walker's own object, changed by its next call: copy one to keep it. */
export interface Walker {
  advance(dtMs: number, ground?: GroundFn): Pose;
  pose(): Pose;
  retarget(plan: WalkPlan): void;
  reset(): void;
}
