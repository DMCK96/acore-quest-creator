import { seededRandom } from './random';
import { RUN_SPEED, WALK_SPEED, WANDER_PAUSE_MAX_MS, WANDER_PAUSE_MIN_MS } from './tuning';
import type { GroundFn, Pose, Vec3, Walker, WalkPlan } from './types';

type Kind = WalkPlan['type'];

const EPSILON = 1e-9;
const MAX_STEPS = 10000;

/** The kind a plan really behaves as: a path needs points, a wander needs a radius. */
export function kindOf(plan: WalkPlan): Kind {
  if (plan.type === 'path' && plan.path !== null && plan.path.length > 0) return 'path';
  if (plan.type === 'wander' && plan.wander > 0) return 'wander';
  return 'idle';
}

type Mode = 'walking' | 'waiting' | 'stopped';

export function createWalker(initialPlan: WalkPlan, seed: number): Walker {
  let plan = initialPlan;
  let rng = seededRandom(seed);
  let pos: Vec3 = { ...plan.home };
  let heading = plan.facing;
  let mode: Mode = 'stopped';
  let waitMs = 0;
  // Path: the point being walked to, or waited at; -1 before the first leg leaves home.
  let index = 0;
  // Path: the point the current leg leaves, or null for the first leg from home.
  let fromIndex: number | null = null;
  let running = false;
  let target: Vec3 = pos;
  let legStartZ = 0;
  let legLength = 0;

  const dist = (a: Vec3, b: Vec3) => Math.hypot(b.x - a.x, b.y - a.y);

  function pause() {
    waitMs = WANDER_PAUSE_MIN_MS + rng() * (WANDER_PAUSE_MAX_MS - WANDER_PAUSE_MIN_MS);
    mode = 'waiting';
  }

  function beginLeg(to: Vec3, run: boolean) {
    target = to;
    running = run;
    legStartZ = pos.z;
    legLength = dist(pos, to);
    if (legLength > EPSILON) heading = Math.atan2(to.y - pos.y, to.x - pos.x);
    mode = 'walking';
  }

  function pickWanderTarget() {
    const r = plan.wander * Math.sqrt(rng());
    const a = rng() * Math.PI * 2;
    beginLeg({ x: plan.home.x + r * Math.cos(a), y: plan.home.y + r * Math.sin(a), z: pos.z }, false);
  }

  function pickPathTarget() {
    const points = plan.path ?? [];
    const here = index;
    for (let tries = 1; tries <= points.length; tries++) {
      const next = (here + tries) % points.length;
      if (dist(pos, points[next]) <= EPSILON) continue;
      index = next;
      fromIndex = here >= 0 ? here : null;
      beginLeg(points[next], here >= 0 && points[here].run);
      return;
    }
    mode = 'stopped'; // every leg is zero-length
  }

  function chooseNext() {
    if (kindOf(plan) === 'wander') pickWanderTarget();
    else pickPathTarget();
  }

  function arrive() {
    pos = { ...target };
    const points = plan.path ?? [];
    if (kindOf(plan) === 'path') {
      waitMs = points[index].delay;
      mode = 'waiting';
    } else {
      pause();
    }
  }

  function start() {
    rng = seededRandom(seed);
    pos = { ...plan.home };
    heading = plan.facing;
    fromIndex = null;
    index = -1;
    running = false;
    const kind = kindOf(plan);
    if (kind === 'path') {
      waitMs = 0;
      mode = 'waiting';
    } else if (kind === 'wander') {
      pause();
    } else {
      mode = 'stopped';
    }
  }

  /** Moves part of the way along the current leg; the leg is longer than `ms` of travel. */
  function walkPartway(ms: number) {
    const remaining = dist(pos, target);
    const step = (ms * speedOf()) / 1000;
    const ratio = step / remaining;
    pos = { x: pos.x + (target.x - pos.x) * ratio, y: pos.y + (target.y - pos.y) * ratio, z: pos.z };
    if (kindOf(plan) === 'path') pos.z = legStartZ + (target.z - legStartZ) * (1 - (remaining - step) / legLength);
  }

  const speedOf = () => (running ? RUN_SPEED : WALK_SPEED);

  function advance(dtMs: number, ground?: GroundFn): Pose {
    let left = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
    const wandering = kindOf(plan) === 'wander';
    const before = pos;
    for (let guard = 0; guard < MAX_STEPS && mode !== 'stopped'; guard++) {
      if (mode === 'walking') {
        const need = (dist(pos, target) * 1000) / speedOf();
        if (need <= left) {
          left -= need;
          arrive();
        } else {
          walkPartway(left);
          break;
        }
      } else {
        if (waitMs > left) {
          waitMs -= left;
          break;
        }
        left -= waitMs;
        waitMs = 0;
        chooseNext();
      }
    }
    if (wandering && ground && pos !== before) {
      const z = ground(pos.x, pos.y, pos.z);
      if (z !== null) pos.z = z;
    }
    return pose();
  }

  function pose(): Pose {
    const gait = mode === 'walking' ? (running ? 'run' : 'walk') : 'stand';
    return { x: pos.x, y: pos.y, z: pos.z, heading, gait };
  }

  function retarget(next: WalkPlan) {
    const sameKind = kindOf(next) === kindOf(plan);
    plan = next;
    if (!sameKind) {
      start();
      return;
    }
    if (kindOf(plan) === 'path') retargetPath();
    else if (kindOf(plan) === 'wander') retargetWander();
  }

  function retargetPath() {
    const points = plan.path!;
    index = Math.min(index, points.length - 1);
    if (mode === 'walking') {
      const run = fromIndex !== null && points[Math.min(fromIndex, points.length - 1)].run;
      beginLeg(points[index], run);
    } else if (mode === 'waiting') {
      if (index >= 0) waitMs = Math.min(waitMs, points[index].delay);
    } else {
      chooseNext();
    }
  }

  function retargetWander() {
    const outside = (p: Vec3) => dist(plan.home, p) > plan.wander;
    if (outside(pos) || (mode === 'walking' && outside(target))) pickWanderTarget();
  }

  start();
  return { advance, pose, retarget, reset: start };
}
