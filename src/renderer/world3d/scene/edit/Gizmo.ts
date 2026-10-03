import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { Placement } from '@core/world/layer';

/**
 * The move and rotate handles on whatever is being edited in the 3D view: a spawn, or one point of
 * a route. Three's own TransformControls drive a stand-in object, and every change is copied onto the
 * real one (the map's groups do not update their matrices by themselves). A move along the ground
 * keeps the thing on the drawn ground under it; only a drag of the Z arrow lifts it freely.
 */

const UP = new THREE.Vector3(0, 0, 1);
const X = new THREE.Vector3(1, 0, 0);
const TWO_PI = Math.PI * 2;
/** How far above a point the ground is looked for, so a hill under it is still found */
const GROUND_PROBE = 50;

/**
 * Where an object stands and how it is turned, as a spawn stores it: facing between 0 and 2π. An NPC
 * drawn lifted onto the ground (`userData.lift`) is read at the height it is stored at.
 */
export function placementOf(object: THREE.Object3D, kind: 'creature' | 'object'): Placement {
  const facing = X.clone().applyQuaternion(object.quaternion);
  const yaw = Math.atan2(facing.y, facing.x);
  const q = object.quaternion;
  return {
    x: object.position.x,
    y: object.position.y,
    z: object.position.z - (object.userData.lift ?? 0),
    orientation: yaw < 0 ? yaw + TWO_PI : yaw,
    rotation: kind === 'object' ? [q.x, q.y, q.z, q.w] : null,
  };
}

/** A quaternion for a placement: an object's own rotation, or a turn about Z by the facing */
export function quaternionOf(placement: Placement): THREE.Quaternion {
  return placement.rotation
    ? new THREE.Quaternion(...placement.rotation)
    : new THREE.Quaternion().setFromAxisAngle(UP, placement.orientation);
}

export type GizmoMode = 'move' | 'rotate';

/** What the gizmo works on: a spawn turns, a route point only moves */
export type GizmoTarget = { object: THREE.Object3D; turns: 'all' | 'z' | 'none' };

export interface GizmoEvents {
  /** A drag began, with the target as it stood */
  started(): void;
  /** A drag ended; `lifted` when it was a Z-arrow move, which keeps its own height */
  ended(lifted: boolean): void;
}

export class Gizmo {
  readonly #controls: TransformControls;
  readonly #proxy = new THREE.Object3D();
  readonly #ground: () => THREE.Object3D[];
  readonly #down = new THREE.Raycaster();
  #target: GizmoTarget | null = null;
  #mode: GizmoMode = 'move';

  constructor(camera: THREE.Camera, dom: HTMLElement, scene: THREE.Scene, ground: () => THREE.Object3D[], events: GizmoEvents) {
    this.#ground = ground;
    this.#controls = new TransformControls(camera, dom);
    this.#controls.setSpace('world');
    scene.add(this.#proxy);
    scene.add(this.#controls);

    let axis: string | null = null;
    this.#controls.addEventListener('mouseDown', () => {
      axis = this.#controls.axis;
      events.started();
    });
    this.#controls.addEventListener('objectChange', () => this.#follow(axis));
    this.#controls.addEventListener('mouseUp', () => events.ended(this.#mode === 'move' && axis === 'Z'));
  }

  /** Whether the pointer is over a handle (a press there is the gizmo's, not the camera's) */
  get hovered(): boolean {
    return this.#controls.object !== undefined && this.#controls.axis !== null;
  }

  get dragging(): boolean {
    return this.#controls.dragging;
  }

  get target(): GizmoTarget | null {
    return this.#target;
  }

  attach(target: GizmoTarget): void {
    this.#target = target;
    this.#proxy.position.copy(target.object.position);
    this.#proxy.quaternion.copy(target.object.quaternion);
    this.#proxy.updateMatrixWorld(true);
    this.#controls.attach(this.#proxy);
    this.#apply();
  }

  detach(): void {
    this.#target = null;
    this.#controls.detach();
  }

  setMode(mode: GizmoMode): void {
    this.#mode = mode;
    this.#apply();
  }

  dispose(): void {
    this.#controls.detach();
    this.#controls.dispose();
    this.#controls.removeFromParent();
    this.#proxy.removeFromParent();
  }

  /** A route point only moves; an NPC only turns about Z; an object turns every way */
  #apply(): void {
    const turns = this.#target?.turns ?? 'none';
    const rotate = this.#mode === 'rotate' && turns !== 'none';
    this.#controls.setMode(rotate ? 'rotate' : 'translate');
    this.#controls.showX = !rotate || turns === 'all';
    this.#controls.showY = !rotate || turns === 'all';
    this.#controls.showZ = true;
  }

  /** Copies the stand-in onto the target; a move along the ground keeps it on the drawn ground */
  #follow(axis: string | null): void {
    const target = this.#target;
    if (!target) return;
    if (this.#controls.mode === 'translate' && axis !== 'Z') {
      const ground = this.groundAt(this.#proxy.position.x, this.#proxy.position.y, this.#proxy.position.z);
      if (ground !== null) this.#proxy.position.z = ground;
    }
    target.object.position.copy(this.#proxy.position);
    if (this.#controls.mode === 'rotate') target.object.quaternion.copy(this.#proxy.quaternion);
    target.object.updateMatrixWorld(true);
  }

  /** The drawn ground (terrain or a building's floor) under a point, or null over nothing */
  groundAt(x: number, y: number, z: number): number | null {
    this.#down.set(new THREE.Vector3(x, y, z + GROUND_PROBE), new THREE.Vector3(0, 0, -1));
    return this.#down.intersectObjects(this.#ground(), true)[0]?.point.z ?? null;
  }
}
