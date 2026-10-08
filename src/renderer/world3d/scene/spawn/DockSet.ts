import type * as THREE from 'three';
import type { ViewSpawns } from '../../../../core/db/view-spawns.js';
import type { EntityLooks } from '../../../../core/entities/view-spawns.js';
import type { Dock } from '../../../../core/map/transport-docks.js';
import type { Frame } from '../../../../core/map/transport-frame.js';
import type { WorldLayer } from '../../../../core/world/layer.js';
import type { PickedSpawn, SpawnInfo, SpawnSource, SpawnVisibility } from './SpawnManager.js';

type Kind = 'creature' | 'object';

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
  configure(patch: Partial<DockState>): void;
  /** The nearest passenger a ray passes through, with how far along the ray */
  pick(ray: THREE.Ray, maxDistance: number): { spawn: PickedSpawn; distance: number } | null;
  find(kind: Kind, guid: number): THREE.Object3D | null;
  picked(kind: Kind, guid: number): PickedSpawn | null;
  info(kind: Kind, guid: number): SpawnInfo | null;
  cull(camera: THREE.Vector3, frustum?: THREE.Frustum): void;
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

  get size(): number {
    return this.#docks.size;
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

  pick(ray: THREE.Ray, maxDistance = Infinity): PickedSpawn | null {
    return this.pickHit(ray, maxDistance)?.spawn ?? null;
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
