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

/** Ground height at (x, y), given the last known z; null where there is no ground. */
export type GroundFn = (x: number, y: number, z: number) => number | null;

export interface Walker {
  advance(dtMs: number, ground?: GroundFn): Pose;
  pose(): Pose;
  retarget(plan: WalkPlan): void;
  reset(): void;
}
