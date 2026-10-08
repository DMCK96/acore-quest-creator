import { createWalker, kindOf } from '../../../../core/world/walk/walker.js';
import type { GroundFn, Pose, Walker, WalkPlan } from '../../../../core/world/walk/types.js';
import type { MovementControl } from './movement-control.js';

/** Where an NPC's poses go, and the ground it walks on */
export type WalkTarget = { apply(pose: Pose): void; readonly ground?: GroundFn };

/**
 * What to do with an NPC this tick: walk it on the ground (in view), walk it without looking for the
 * ground (out of view; it finds it when seen again), hold it at home (it is being worked on), or leave
 * it (out of range, or its layer hidden)
 */
export type Activity = 'move' | 'unseen' | 'hold' | 'skip';

type Entry = { walker: Walker; plan: WalkPlan; idle: boolean; key: string; target: WalkTarget; away: boolean; paused: boolean };

const DEFAULT_MAX_STEP_MS = 250;

const isHome = (pose: Pose, plan: WalkPlan) =>
  pose.x === plan.home.x && pose.y === plan.home.y && pose.z === plan.home.z && pose.gait === 'stand' && pose.heading === plan.facing;

/** Steps every tracked NPC's walker and hands the pose to its target; runs, pauses and resets them with a MovementControl */
export class MovementDriver {
  private readonly entries = new Map<number, Entry>();
  private seenEpoch: number;

  constructor(
    private readonly control: MovementControl,
    private readonly maxStepMs = DEFAULT_MAX_STEP_MS,
  ) {
    this.seenEpoch = control.epoch;
  }

  get size(): number {
    return this.entries.size;
  }

  /**
   * Starts walking an NPC; the same `key` again only swaps the target, a new `key` gives it the new plan
   * (a moved or turned home starts it again from there). A target tracked again is handed the pose the
   * NPC has (standing while paused), so a redraw that put it home does not leave it there.
   */
  track(guid: number, plan: WalkPlan, key: string, target: WalkTarget): void {
    const entry = this.entries.get(guid);
    if (!entry) {
      const fresh: Entry = { walker: createWalker(plan, guid), plan, idle: kindOf(plan) === 'idle', key, target, away: false, paused: false };
      this.entries.set(guid, fresh);
      target.apply(fresh.walker.pose());
      return;
    }
    entry.target = target;
    if (entry.key !== key) {
      entry.key = key;
      entry.plan = plan;
      entry.idle = kindOf(plan) === 'idle';
      entry.walker.retarget(plan);
      entry.away = !isHome(entry.walker.pose(), plan);
    }
    this.refresh(guid);
  }

  /** Hands an NPC's target the pose it has again (standing while paused) */
  refresh(guid: number): void {
    const entry = this.entries.get(guid);
    if (!entry) return;
    const pose = entry.walker.pose();
    entry.paused = !this.control.playing;
    entry.target.apply(this.control.playing ? pose : { ...pose, gait: 'stand' });
  }

  untrack(guid: number): void {
    this.entries.delete(guid);
  }

  tick(dtMs: number, activity: (guid: number) => Activity): void {
    if (this.control.epoch !== this.seenEpoch) {
      this.seenEpoch = this.control.epoch;
      for (const entry of this.entries.values()) this.sendHome(entry);
    }
    const playing = this.control.playing;
    // forEach, not for...of over entries: no [guid, entry] pair is made per NPC per frame
    this.entries.forEach((entry, guid) => {
      const now = activity(guid);
      // One being worked on goes home whether or not they walk
      if (now === 'hold') {
        if (entry.away) this.sendHome(entry);
      } else if (!playing) this.hold(entry);
      else this.step(entry, dtMs, now);
    });
  }

  private step(entry: Entry, dtMs: number, activity: Exclude<Activity, 'hold'>): void {
    entry.paused = false;
    if (activity === 'skip' || entry.idle || dtMs <= 0) return;
    const pose = entry.walker.advance(Math.min(dtMs, this.maxStepMs), activity === 'move' ? entry.target.ground : undefined);
    entry.away = !isHome(pose, entry.plan);
    entry.target.apply(pose);
  }

  /** Paused: an NPC that is away stands where it is, applied once */
  private hold(entry: Entry): void {
    if (!entry.away || entry.paused) return;
    entry.paused = true;
    entry.target.apply({ ...entry.walker.pose(), gait: 'stand' });
  }

  private sendHome(entry: Entry): void {
    entry.walker.reset();
    entry.away = false;
    entry.paused = false;
    entry.target.apply(entry.walker.pose());
  }
}
