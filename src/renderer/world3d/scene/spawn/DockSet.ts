import * as THREE from 'three';
import type { ViewSpawns } from '../../../../core/db/view-spawns.js';
import type { EntityLooks } from '../../../../core/entities/view-spawns.js';
import type { Dock } from '../../../../core/map/transport-docks.js';
import type { Frame } from '../../../../core/map/transport-frame.js';
import type { WorldLayer } from '../../../../core/world/layer.js';
import type { Candidates } from '../edit/box.js';
import type { PickedSpawn, SpawnInfo, SpawnSource, SpawnVisibility } from './SpawnManager.js';

type Kind = 'creature' | 'object';

/** Whether a kind of passenger was capped, and why none could be read */
export type DockStatus = { capped: { creatures: boolean; objects: boolean }; error: string | null };

/** Everything the scene tells its spawn manager, kept so a dock that comes into range later is told too */
export interface DockState {
  source: SpawnSource | null;
  looks: EntityLooks;
  own: ViewSpawns;
  visibility: SpawnVisibility;
  layer: WorldLayer;
  groups: ReadonlyMap<number, readonly { kind: 'npc' | 'object'; guid: number }[]>;
}

/** One drawn dock: a vessel and its passengers, which the scene sees through this */
export interface DockInstance {
  /** The vessel and its passengers, put under the scene while the dock is in range */
  readonly root: THREE.Object3D;
  /** The vessel alone, whose deck is ground to stand and drop things on */
  readonly decor: THREE.Object3D;
  configure(patch: Partial<DockState>): void;
  /** The nearest passenger a ray passes through, with how far along the ray */
  pick(ray: THREE.Ray, maxDistance: number): { spawn: PickedSpawn; distance: number } | null;
  find(kind: Kind, guid: number): THREE.Object3D | null;
  picked(kind: Kind, guid: number): PickedSpawn | null;
  info(kind: Kind, guid: number): SpawnInfo | null;
  cull(camera: THREE.Vector3, frustum?: THREE.Frustum): void;
  /** Once a frame, `deltaTime` seconds on: walks the passengers, and asks again for them when their answer failed and has aged */
  update(deltaTime: number, camera: THREE.Camera): void;
  /** What a selection box can catch among the drawn passengers */
  candidates(camera: THREE.Vector3): Candidates['spawns'];
  readonly status: DockStatus;
  dispose(): void;
}

/**
 * The docked vessels of a scene: one instance for each dock in range, made when the camera comes near and
 * disposed when it leaves. Every setting the scene gives its spawns reaches all of them, so the same rows
 * are drawn at each dock.
 */
export class DockSet {
  #create: (dock: Dock) => DockInstance;
  #parent: THREE.Object3D;
  #docks = new Map<string, { dock: Dock; instance: DockInstance }>();
  #state: Partial<DockState> = {};
  #enabled = true;

  constructor(options: { create(dock: Dock): DockInstance; parent: THREE.Object3D }) {
    this.#create = options.create;
    this.#parent = options.parent;
  }

  /** The vessels drawn, for the scene to count as ground */
  get decor(): THREE.Object3D[] {
    return [...this.#docks.values()].map(({ instance }) => instance.decor);
  }

  /** Off, nothing is drawn or picked and what was drawn is freed */
  setEnabled(enabled: boolean): void {
    this.#enabled = enabled;
    if (!enabled) this.#clear();
  }

  /** Makes the instances of the listed docks that are near, and frees the rest */
  sync(docks: readonly Dock[], near: (dock: Dock) => boolean): void {
    const wanted = this.#enabled ? docks.filter(near) : [];
    const keys = new Set(wanted.map((d) => d.key));
    for (const [key, entry] of this.#docks) {
      if (keys.has(key)) continue;
      this.#free(entry.instance);
      this.#docks.delete(key);
    }
    for (const dock of wanted) {
      if (this.#docks.has(dock.key)) continue;
      const instance = this.#create(dock);
      this.#parent.add(instance.root);
      if (Object.keys(this.#state).length > 0) instance.configure({ ...this.#state });
      this.#docks.set(dock.key, { dock, instance });
    }
  }

  configure(patch: Partial<DockState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const { instance } of this.#docks.values()) instance.configure(patch);
  }

  /** The nearest passenger of any dock along a ray, no further than `maxDistance`, with its distance */
  pickHit(ray: THREE.Ray, maxDistance = Infinity): { spawn: PickedSpawn; distance: number } | null {
    let best: { spawn: PickedSpawn; distance: number } | null = null;
    for (const { instance } of this.#docks.values()) {
      const hit = instance.pick(ray, maxDistance);
      if (hit && hit.distance <= maxDistance && (!best || hit.distance < best.distance)) best = hit;
    }
    return best;
  }

  /** The nearest docked vessel a ray passes through, no further than `maxDistance`, with its dock and distance */
  pickVessel(ray: THREE.Ray, maxDistance = Infinity): { dock: Dock; distance: number } | null {
    const caster = new THREE.Raycaster(ray.origin, ray.direction, 0, maxDistance);
    let best: { dock: Dock; distance: number } | null = null;
    for (const { dock, instance } of this.#docks.values()) {
      const hit = caster.intersectObject(instance.decor, true)[0];
      if (hit && (!best || hit.distance < best.distance)) best = { dock, distance: hit.distance };
    }
    return best;
  }

  find(kind: Kind, guid: number): THREE.Object3D | null {
    return this.#first((i) => i.find(kind, guid));
  }

  picked(kind: Kind, guid: number): PickedSpawn | null {
    return this.#first((i) => i.picked(kind, guid));
  }

  info(kind: Kind, guid: number): SpawnInfo | null {
    return this.#first((i) => i.info(kind, guid));
  }

  /** The frame of the dock a spawn is drawn at, or null when no dock draws it */
  frameOf(kind: Kind, guid: number): Frame | null {
    for (const { dock, instance } of this.#docks.values()) if (instance.find(kind, guid)) return dock.frame;
    return null;
  }

  /** Once a frame: each dock walks its passengers and asks again for what failed */
  update(deltaTime: number, camera: THREE.Camera): void {
    for (const { instance } of this.#docks.values()) instance.update(deltaTime, camera);
  }

  candidates(camera: THREE.Vector3): Candidates['spawns'] {
    return [...this.#docks.values()].flatMap(({ instance }) => instance.candidates(camera));
  }

  /** The docks' passengers together: any kind capped at one, and the first reason one could not be read */
  get status(): DockStatus {
    const all = [...this.#docks.values()].map(({ instance }) => instance.status);
    return {
      capped: { creatures: all.some((s) => s.capped.creatures), objects: all.some((s) => s.capped.objects) },
      error: all.find((s) => s.error)?.error ?? null,
    };
  }

  cull(camera: THREE.Vector3, frustum?: THREE.Frustum): void {
    for (const { instance } of this.#docks.values()) instance.cull(camera, frustum);
  }

  dispose(): void {
    this.#clear();
  }

  #first<T>(ask: (instance: DockInstance) => T | null): T | null {
    for (const { instance } of this.#docks.values()) {
      const answer = ask(instance);
      if (answer) return answer;
    }
    return null;
  }

  #free(instance: DockInstance): void {
    instance.root.removeFromParent();
    instance.dispose();
  }

  #clear(): void {
    for (const { instance } of this.#docks.values()) this.#free(instance);
    this.#docks.clear();
  }
}
