import { seededRandom } from './random';
import { GROUND_REACH, MAX_GRADE, PROBE_STEP, RUN_SPEED, WALK_SPEED, WANDER_PAUSE_MAX_MS, WANDER_PAUSE_MIN_MS } from './tuning';
import type { GroundFn, Pose, Vec3, Walker, WalkPlan, WalkPoint } from './types';

type Kind = WalkPlan['type'];

const EPSILON = 1e-9;
const MAX_STEPS = 10000;
/** The shortest walk between two looks at the ground that a slope is worked out over, in yards */
const MIN_GRADE_RUN = 0.1;

/** The kind a plan really behaves as: a path needs points, a wander needs a radius. */
export function kindOf(plan: WalkPlan): Kind {
  if (plan.type === 'path' && plan.path !== null && plan.path.length > 0) return 'path';
  if (plan.type === 'wander' && plan.wander > 0) return 'wander';
  return 'idle';
}

/** A point's wait in ms: one that is not a number, or is below 0, is no wait. */
const delayOf = (point: WalkPoint): number => (Number.isFinite(point.delay) && point.delay > 0 ? point.delay : 0);

/** Whether a new plan puts the NPC somewhere else: another kind, or a moved or turned home. */
const movesHome = (from: WalkPlan, to: WalkPlan): boolean =>
  kindOf(from) !== kindOf(to) || from.home.x !== to.home.x || from.home.y !== to.home.y || from.home.z !== to.home.z || from.facing !== to.facing;

type Mode = 'walking' | 'waiting' | 'stopped';

export function createWalker(initialPlan: WalkPlan, seed: number): Walker {
  let plan = initialPlan;
  let kind: Kind;
  let rng!: () => number;
  // Where it is; on a path, z is the height between the points (the ground's lift is kept apart)
  const pos: Vec3 = { x: 0, y: 0, z: 0 };
  let heading!: number;
  let mode!: Mode;
  let waitMs!: number;
  // Path: the point being walked to, or waited at; -1 before the first leg leaves home.
  let index!: number;
  // Path: the point the current leg leaves, or null for the first leg from home.
  let fromIndex!: number | null;
  let running!: boolean;
  let target!: Vec3;
  let legStartZ!: number;
  let legLength!: number;

  // The ground: looked for once a leg starts and then every PROBE_STEP yards walked
  /** Yards walked since the ground was last looked for */
  let unprobed!: number;
  let probeSoon!: boolean;
  /** Path: how far above the height between the points the ground was found */
  let lift!: number;
  /** Wander: yards along the leg; the height last known there and whether it was found on the ground; the slope since */
  let along!: number;
  let refAlong!: number;
  let refZ!: number;
  let refOnGround!: boolean;
  let grade!: number;

  const out: Pose = { x: 0, y: 0, z: 0, heading: 0, gait: 'stand' };

  const dist = (a: Vec3, b: Vec3) => Math.hypot(b.x - a.x, b.y - a.y);
  const speedOf = () => (running ? RUN_SPEED : WALK_SPEED);

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
    along = 0;
    refAlong = 0;
    refZ = pos.z;
    grade = 0;
    probeSoon = true;
    mode = 'walking';
  }

  function pickWanderTarget() {
    const r = plan.wander * Math.sqrt(rng());
    const a = rng() * Math.PI * 2;
    beginLeg({ x: plan.home.x + r * Math.cos(a), y: plan.home.y + r * Math.sin(a), z: pos.z }, false);
  }

  /** The next leg; a point it already stands on is arrived at once (waited at, and its pace kept for the leg after) */
  function pickPathTarget() {
    const points = plan.path!;
    let here = index;
    for (let tries = 0; tries < points.length; tries++) {
      const next = (here + 1) % points.length;
      const point = points[next]!;
      if (dist(pos, point) > EPSILON) {
        index = next;
        fromIndex = here >= 0 ? here : null;
        beginLeg(point, here >= 0 && points[here]!.run);
        return;
      }
      here = next;
      pos.z = point.z;
      if (delayOf(point) > 0) {
        index = next;
        waitMs = delayOf(point);
        mode = 'waiting';
        return;
      }
    }
    index = here;
    mode = 'stopped'; // every point is where it stands, with no wait
  }

  function chooseNext() {
    if (kind === 'wander') pickWanderTarget();
    else pickPathTarget();
  }

  /** Walks `yards` on: a wanderer's height follows the slope last found */
  function walked(yards: number) {
    unprobed += yards;
    along += yards;
    if (kind === 'wander') pos.z = refZ + grade * (along - refAlong);
  }

  function arrive() {
    const rest = dist(pos, target);
    pos.x = target.x;
    pos.y = target.y;
    walked(rest);
    if (kind === 'path') {
      pos.z = target.z;
      waitMs = delayOf(plan.path![index]!);
      mode = 'waiting';
    } else {
      pause();
    }
  }

  function start() {
    kind = kindOf(plan);
    rng = seededRandom(seed);
    pos.x = plan.home.x;
    pos.y = plan.home.y;
    pos.z = plan.home.z;
    heading = plan.facing;
    fromIndex = null;
    index = -1;
    running = false;
    target = plan.home;
    legStartZ = pos.z;
    legLength = 0;
    unprobed = 0;
    probeSoon = true;
    lift = 0;
    along = 0;
    refAlong = 0;
    refZ = pos.z;
    // Home is the row's height, which may sit under the drawn ground: no slope is worked out from it
    refOnGround = false;
    grade = 0;
    if (kind === 'path') {
      waitMs = 0;
      mode = 'waiting';
    } else if (kind === 'wander') {
      pause();
    } else {
      waitMs = 0;
      mode = 'stopped';
    }
  }

  /** Moves part of the way along the current leg; the leg is longer than `ms` of travel. */
  function walkPartway(ms: number) {
    const remaining = dist(pos, target);
    const step = (ms * speedOf()) / 1000;
    const ratio = step / remaining;
    pos.x += (target.x - pos.x) * ratio;
    pos.y += (target.y - pos.y) * ratio;
    walked(step);
    if (kind === 'path') pos.z = legStartZ + (target.z - legStartZ) * (1 - (remaining - step) / legLength);
  }

  /**
   * Looks for the ground where it now is. A path walker is lifted onto ground up to GROUND_REACH above
   * the height between its points; a wanderer takes the ground within reach above or below it, the
   * reach growing with how far it walked unlooked (out of view), and keeps its height where none is found.
   */
  function probe(ground: GroundFn) {
    if (kind === 'path') {
      const found = ground(pos.x, pos.y, pos.z + GROUND_REACH, GROUND_REACH);
      lift = found === null ? 0 : Math.min(Math.max(found - pos.z, 0), GROUND_REACH);
    } else {
      const reach = GROUND_REACH + unprobed;
      const found = ground(pos.x, pos.y, pos.z + reach, 2 * reach);
      if (found !== null) {
        const run = along - refAlong;
        if (refOnGround && run >= MIN_GRADE_RUN) grade = Math.min(Math.max((found - refZ) / run, -MAX_GRADE), MAX_GRADE);
        refZ = found;
        refAlong = along;
        refOnGround = true;
        pos.z = found;
      }
    }
    unprobed = 0;
    probeSoon = false;
  }

  function advance(dtMs: number, ground?: GroundFn): Pose {
    let left = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
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
    if (ground && kind !== 'idle' && unprobed > 0 && (probeSoon || unprobed >= PROBE_STEP)) probe(ground);
    return pose();
  }

  /** The walker's own pose object, changed by its next call: copy it to keep it */
  function pose(): Pose {
    out.x = pos.x;
    out.y = pos.y;
    out.z = pos.z + lift;
    out.heading = heading;
    out.gait = mode === 'walking' ? (running ? 'run' : 'walk') : 'stand';
    return out;
  }

  function retarget(next: WalkPlan) {
    const restart = movesHome(plan, next);
    plan = next;
    if (restart) {
      start();
      return;
    }
    if (kind === 'path') retargetPath();
    else if (kind === 'wander') retargetWander();
  }

  function retargetPath() {
    const points = plan.path!;
    index = Math.min(index, points.length - 1);
    if (mode === 'walking') {
      const run = fromIndex !== null && points[Math.min(fromIndex, points.length - 1)]!.run;
      beginLeg(points[index]!, run);
    } else if (mode === 'waiting') {
      if (index >= 0) waitMs = Math.min(waitMs, delayOf(points[index]!));
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
