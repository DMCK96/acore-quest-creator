/**
 * The drawn NPCs that walk: each creature is tracked by a `MovementDriver` with the plan its row gives
 * (its path, else its wander radius), and each pose it hands back is drawn on the NPC's models, through
 * the spawn manager's frame, with each model switched to standing, walking or running. An NPC drawn by
 * two areas at once (one on a tile edge) is one walker drawn on both models.
 */
import * as THREE from 'three';
import type { ViewCreature } from '../../../../core/db/view-spawns.js';
import { toWorldInto, type Frame } from '../../../../core/map/transport-frame.js';
import { planKey, walkPlanOf } from '../../../../core/world/walk/plan.js';
import type { Gait, GroundFn, Pose, Vec3 } from '../../../../core/world/walk/types.js';
import { MovementDriver, type Activity, type WalkTarget } from './MovementDriver.js';
import type { MovementControl } from './movement-control.js';

/** A drawn NPC: a model can switch its animation between standing, walking and running; a marker cannot */
type Walked = THREE.Object3D & { animation?: { setGait(gait: Gait): void } };

type WalkersOptions = {
  /** The vessel the rows are local to (the identity frame when none) */
  frame(): Frame;
  /** The ground NPCs walk on now; none on a vessel, whose deck is flat */
  ground(): GroundFn | undefined;
};

/** An NPC that walks: the models it is drawn by, and the target its poses go to */
type Tracked = { objects: Set<Walked>; target: WalkTarget };

const UP = new THREE.Vector3(0, 0, 1);
const local: Vec3 = { x: 0, y: 0, z: 0 };
const world: Vec3 = { x: 0, y: 0, z: 0 };

/** Whether a pose is where the row stands, so the NPC is drawn lifted onto the ground as it is when not walking */
const atHome = (pose: Pose, row: ViewCreature | undefined) => row !== undefined && pose.x === row.x && pose.y === row.y && pose.z === row.z;

/** Draws a pose on a model: through the frame, lifted at home, turned to its heading (no allocation: it runs every frame) */
function draw(object: Walked, pose: Pose, frame: Frame): void {
  local.x = pose.x;
  local.y = pose.y;
  // At home it stands where it is drawn when not walking (lifted onto the ground); away, the ground is the walker's
  local.z = pose.z + (atHome(pose, object.userData.row) ? (object.userData.lift ?? 0) : 0);
  toWorldInto(frame, local, world);
  object.position.set(world.x, world.y, world.z);
  object.quaternion.setFromAxisAngle(UP, pose.heading + frame.heading);
  object.updateMatrixWorld(true);
  object.animation?.setGait(pose.gait);
}

export class Walkers {
  #driver: MovementDriver;
  #options: WalkersOptions;
  #tracked = new globalThis.Map<number, Tracked>();
  #activity: (guid: number, object: THREE.Object3D) => Activity = () => 'skip';

  constructor(control: MovementControl, options: WalkersOptions) {
    this.#driver = new MovementDriver(control);
    this.#options = options;
  }

  /**
   * Walks a drawn NPC by its row (a marker is never walked). Tracked again, a row with the same plan
   * keeps walking where it is, a changed one walks on from there, and a moved or turned one starts
   * again from its new place.
   */
  track(object: Walked, row: ViewCreature): void {
    if (object.name === 'marker') return;
    let tracked = this.#tracked.get(row.guid);
    if (!tracked) {
      tracked = this.#trackedOf();
      this.#tracked.set(row.guid, tracked);
    }
    tracked.objects.add(object);
    const plan = walkPlanOf(row);
    this.#driver.track(row.guid, plan, planKey(plan), tracked.target);
  }

  /** Whether this object is drawn walking */
  has(object: THREE.Object3D): boolean {
    const guid: number | undefined = object.userData.spawn?.guid;
    return guid !== undefined && this.#tracked.get(guid)?.objects.has(object) === true;
  }

  /** Draws an NPC's pose on its object again, after something else put it home (its ground lift, a vessel move) */
  refresh(object: THREE.Object3D): void {
    if (this.has(object)) this.#driver.refresh(object.userData.spawn.guid);
  }

  /** Stops drawing an NPC on this object; it stops walking once no object draws it (one drawn again by a new object walks on) */
  untrack(object: THREE.Object3D): void {
    const guid: number | undefined = object.userData.spawn?.guid;
    const tracked = guid === undefined ? undefined : this.#tracked.get(guid);
    if (!tracked?.objects.delete(object as Walked) || tracked.objects.size > 0) return;
    this.#tracked.delete(guid!);
    this.#driver.untrack(guid!);
  }

  /** Steps every tracked NPC by `dtMs`, as `activity` says of it (of the most active of its objects) */
  tick(dtMs: number, activity: (guid: number, object: THREE.Object3D) => Activity): void {
    this.#activity = activity;
    this.#driver.tick(dtMs, this.#activityOf);
  }

  #activityOf = (guid: number): Activity => {
    let best: Activity = 'skip';
    for (const object of this.#tracked.get(guid)?.objects ?? []) {
      const now = this.#activity(guid, object);
      if (now === 'hold' || now === 'move') return now;
      if (now === 'unseen') best = now;
    }
    return best;
  };

  #trackedOf(): Tracked {
    const objects = new Set<Walked>();
    const options = this.#options;
    return {
      objects,
      target: {
        apply: (pose) => {
          const frame = options.frame();
          for (const object of objects) draw(object, pose, frame);
        },
        get ground() {
          return options.ground();
        },
      },
    };
  }
}
