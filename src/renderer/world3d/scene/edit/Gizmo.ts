import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { Placement } from '@core/world/layer';

/**
 * The move and rotate handles of the 3D view's editing: one set, on the middle of what is selected
 * (a spawn, several, or route points). Three's own TransformControls drive a stand-in object, and each
 * change is reported as how far the stand-in has moved and turned since the drag began, for the editor
 * to apply to everything selected. A move along the ground keeps the stand-in on the drawn ground;
 * only a drag of the Z arrow lifts it freely.
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

/** How the handles may turn what they are on: every way (one object), about Z, or not at all (route points) */
export type GizmoTurns = 'all' | 'z' | 'none';

/** A drag so far: moved by `delta`, turned about Z by `angle`, and the stand-in's whole rotation */
export type GizmoChange = { delta: THREE.Vector3; angle: number; quaternion: THREE.Quaternion; axis: string | null };

export interface GizmoEvents {
  /** A drag began */
  started(): void;
  /** The drag moved on */
  moved(change: GizmoChange): void;
  /** A drag ended; `lifted` when it was a Z-arrow move, which keeps its own height */
  ended(lifted: boolean): void | Promise<void>;
}

export class Gizmo {
  readonly #controls: TransformControls;
  readonly #proxy = new THREE.Object3D();
  readonly #ground: () => THREE.Object3D[];
  readonly #down = new THREE.Raycaster();
  #turns: GizmoTurns | null = null;
  #mode: GizmoMode = 'move';
  #start = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };

  constructor(camera: THREE.Camera, dom: HTMLElement, scene: THREE.Scene, ground: () => THREE.Object3D[], events: GizmoEvents) {
    this.#ground = ground;
    this.#controls = new TransformControls(camera, dom);
    this.#controls.setSpace('world');
    scene.add(this.#proxy);
    scene.add(this.#controls);

    let axis: string | null = null;
    this.#controls.addEventListener('mouseDown', () => {
      axis = this.#controls.axis;
      this.#start = { position: this.#proxy.position.clone(), quaternion: this.#proxy.quaternion.clone() };
      events.started();
    });
    this.#controls.addEventListener('objectChange', () => {
      this.#follow(axis);
      events.moved({ delta: this.#proxy.position.clone().sub(this.#start.position), angle: this.#turned(), quaternion: this.#proxy.quaternion.clone(), axis });
    });
    this.#controls.addEventListener('mouseUp', () => void events.ended(this.#mode === 'move' && axis === 'Z'));
  }

  /** Whether the pointer is over a handle (a press there is the gizmo's, not the camera's) */
  get hovered(): boolean {
    return this.#controls.object !== undefined && this.#controls.axis !== null;
  }

  get dragging(): boolean {
    return this.#controls.dragging;
  }

  get attached(): boolean {
    return this.#turns !== null;
  }

  /** Puts the handles at a place, turned as given, allowed to turn as `turns` says */
  attach(at: THREE.Vector3, quaternion: THREE.Quaternion, turns: GizmoTurns): void {
    this.#turns = turns;
    this.#proxy.position.copy(at);
    this.#proxy.quaternion.copy(quaternion);
    this.#proxy.updateMatrixWorld(true);
    this.#controls.attach(this.#proxy);
    this.#apply();
  }

  detach(): void {
    this.#turns = null;
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

  /** Route points only move; NPCs and groups turn about Z; one object turns every way */
  #apply(): void {
    const turns = this.#turns ?? 'none';
    const rotate = this.#mode === 'rotate' && turns !== 'none';
    this.#controls.setMode(rotate ? 'rotate' : 'translate');
    this.#controls.showX = !rotate || turns === 'all';
    this.#controls.showY = !rotate || turns === 'all';
    this.#controls.showZ = true;
  }

  /** A move along the ground keeps the stand-in on the drawn ground under it */
  #follow(axis: string | null): void {
    if (this.#controls.mode === 'translate' && axis !== 'Z') {
      const ground = this.groundAt(this.#proxy.position.x, this.#proxy.position.y, this.#proxy.position.z);
      if (ground !== null) this.#proxy.position.z = ground;
    }
    this.#proxy.updateMatrixWorld(true);
  }

  /** How far the stand-in has turned about Z since the drag began: the turn of its X axis across the ground, between -π and π */
  #turned(): number {
    const before = X.clone().applyQuaternion(this.#start.quaternion);
    const now = X.clone().applyQuaternion(this.#proxy.quaternion);
    const angle = Math.atan2(now.y, now.x) - Math.atan2(before.y, before.x);
    return Math.atan2(Math.sin(angle), Math.cos(angle));
  }

  /** The drawn ground (terrain or a building's floor) under a point, or null over nothing */
  groundAt(x: number, y: number, z: number): number | null {
    this.#down.set(new THREE.Vector3(x, y, z + GROUND_PROBE), new THREE.Vector3(0, 0, -1));
    return this.#down.intersectObjects(this.#ground(), true)[0]?.point.z ?? null;
  }
}
