/**
 * The drawn NPCs that walk: each creature model is tracked by a `MovementDriver` with the plan its row
 * gives (its path, else its wander radius), and each pose it hands back is drawn on the model, through
 * the spawn manager's frame, with the model switched to standing, walking or running.
 */
import * as THREE from 'three';
import type { ViewCreature } from '../../../../core/db/view-spawns.js';
import { planKey, walkPlanOf } from '../../../../core/world/walk/plan.js';
import type { Gait, GroundFn, Pose } from '../../../../core/world/walk/types.js';
import { MovementDriver, type Activity, type WalkTarget } from './MovementDriver.js';
import type { MovementControl } from './movement-control.js';
import type { Transform } from './placement.js';

/** A drawn NPC: a model can switch its animation between standing, walking and running; a marker cannot */
type Walked = THREE.Object3D & { animation?: { setGait(gait: Gait): void } };

type WalkersOptions = {
  /** Where a row stands in the view (carried by the frame, if there is one) */
  transformOf(row: ViewCreature): Transform;
  /** The ground a wanderer walks on now; none on a vessel, whose deck is flat */
  ground(): GroundFn | undefined;
};

/** Whether a pose is where the row stands, so the NPC is drawn lifted onto the ground as it is when not walking */
const atHome = (pose: Pose, row: ViewCreature) => pose.x === row.x && pose.y === row.y && pose.z === row.z;

export class Walkers {
  #driver: MovementDriver;
  #options: WalkersOptions;
  /** The drawn object each tracked NPC's poses go to */
  #tracked = new globalThis.Map<number, Walked>();

  constructor(control: MovementControl, options: WalkersOptions) {
    this.#driver = new MovementDriver(control);
    this.#options = options;
  }

  /**
   * Walks a drawn NPC by its row (a marker is never walked). Tracked again, a row with the same plan
   * keeps walking where it is, and a changed one walks on from there.
   */
  track(object: Walked, row: ViewCreature): void {
    if (object.name === 'marker') return;
    this.#tracked.set(row.guid, object);
    const plan = walkPlanOf(row);
    this.#driver.track(row.guid, plan, planKey(plan), this.#target(object, row));
  }

  /** Stops walking an NPC drawn by this object; one drawn again by a new object (its look changed) walks on */
  untrack(object: THREE.Object3D): void {
    const guid: number | undefined = object.userData.spawn?.guid;
    if (guid === undefined || this.#tracked.get(guid) !== object) return;
    this.#tracked.delete(guid);
    this.#driver.untrack(guid);
  }

  /** Steps every tracked NPC by `dtMs`, as `activity` says of it */
  tick(dtMs: number, activity: (guid: number, object: THREE.Object3D) => Activity): void {
    this.#driver.tick(dtMs, (guid) => activity(guid, this.#tracked.get(guid)!));
  }

  #target(object: Walked, row: ViewCreature): WalkTarget {
    const ground = this.#options.ground();
    return {
      apply: (pose) => {
        const { position, quaternion } = this.#options.transformOf({ ...row, x: pose.x, y: pose.y, z: pose.z, orientation: pose.heading });
        // At home it stands where it is drawn when not walking (lifted onto the ground); away, the ground is the walker's
        object.position.set(position[0], position[1], position[2] + (atHome(pose, row) ? (object.userData.lift ?? 0) : 0));
        object.quaternion.set(...quaternion);
        object.updateMatrixWorld(true);
        object.animation?.setGait(pose.gait);
      },
      ...(ground ? { ground } : {}),
    };
  }
}
