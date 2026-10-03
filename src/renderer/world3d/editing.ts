import * as THREE from 'three';
import type { Placement } from '@core/world/layer';
import type { EditPoint, SpawnEdit, SpawnRef } from './edits';
import { Gizmo, placementOf, quaternionOf, type GizmoMode } from './scene/edit/Gizmo';
import { createHistory } from './scene/edit/history';
import { insertionIndex, withoutPoint } from './scene/edit/route';

/**
 * Editing in the 3D view: the gizmo on the selected spawn or route point, Shift-click and Delete on
 * the selected NPC's route, and undo. Every edit is emitted once, as a whole placement or a whole
 * route, for the view's host to store; the world draws it at once and keeps it until the host says.
 */

export const NOT_SNAPPED = 'The height is from the drawn ground, not the server.';
export const TOO_SHORT = 'A route keeps at least two points.';

type Kind = 'creature' | 'object';

/** What the editor needs of the world it edits */
export interface EditingWorld {
  camera: THREE.Camera;
  dom: HTMLElement;
  scene: THREE.Scene;
  /** The terrain and buildings, which a moved spawn stands on */
  ground(): THREE.Object3D[];
  /** The ground under a place on screen, or null for sky */
  pickGround(ndcX: number, ndcY: number): THREE.Vector3 | null;
  /** The ray from the camera through a place on screen */
  rayAt(ndcX: number, ndcY: number): THREE.Ray;
  findSpawn(kind: Kind, guid: number): THREE.Object3D | null;
  spawnRoute(guid: number): { pathId: number; own: boolean; entry: number; points: EditPoint[] } | null;
  pickRoutePoint(ray: THREE.Ray, guid: number): number | null;
  routeBall(guid: number, point: number): THREE.Object3D | null;
  setPendingRoute(guid: number, points: EditPoint[]): void;
}

export interface EditingOptions {
  onEdit?(edit: SpawnEdit): void;
  /** The server's floor nearest a height at a place, or null when it has none there */
  floorZ?(x: number, y: number, nearZ: number): Promise<number | null>;
  /** Asked once per route before the first change to a world route; false leaves it as it was */
  beforeRouteEdit?(spawn: SpawnRef, pathId: number): Promise<boolean>;
  onNotice?(message: string | null): void;
}

export class Editor {
  readonly #world: EditingWorld;
  readonly #options: EditingOptions;
  readonly #gizmo: Gizmo;
  readonly #history = createHistory();
  /** Each world route's answer to "change it for every spawn that walks it?" */
  readonly #answers = new Map<number, Promise<boolean>>();
  #selected: { kind: Kind; guid: number } | null = null;
  /** The selected point of the selected NPC's route, if one is */
  #point: number | null = null;
  #mode: GizmoMode = 'move';
  #before: Placement | EditPoint[] | null = null;

  constructor(world: EditingWorld, options: EditingOptions) {
    this.#world = world;
    this.#options = options;
    this.#gizmo = new Gizmo(world.camera, world.dom, world.scene, world.ground, {
      started: () => this.#started(),
      ended: (lifted) => void this.#ended(lifted),
    });
  }

  /** Whether a press is the gizmo's, so the camera leaves it alone */
  get blocked(): boolean {
    return this.#gizmo.hovered || this.#gizmo.dragging;
  }

  /** A newly selected spawn, or none; its route point selection goes with the old one */
  select(spawn: { kind: Kind; guid: number } | null): void {
    this.#selected = spawn ? { kind: spawn.kind, guid: spawn.guid } : null;
    this.#point = null;
  }

  setMode(mode: GizmoMode): void {
    this.#mode = mode;
    this.#gizmo.setMode(mode);
  }

  /**
   * A click while an NPC with a route is selected: Shift adds a point, a click on a point selects it.
   * True when the click was the route's, so it selects no spawn.
   */
  click(ndcX: number, ndcY: number, shift: boolean): boolean {
    const selected = this.#selected;
    if (!selected || selected.kind !== 'creature') return false;
    const route = this.#world.spawnRoute(selected.guid);
    if (!route) return false;
    if (shift) {
      const ground = this.#world.pickGround(ndcX, ndcY);
      if (!ground) return true;
      const index = insertionIndex(route.points, ground, this.#point);
      const points = [...route.points.slice(0, index), { x: ground.x, y: ground.y, z: ground.z }, ...route.points.slice(index)];
      this.#point = index;
      void this.#routeEdit(route.points, points);
      return true;
    }
    const hit = this.#world.pickRoutePoint(this.#world.rayAt(ndcX, ndcY), selected.guid);
    if (hit === null) return false;
    this.#point = hit;
    this.#options.onNotice?.(null);
    return true;
  }

  /** The editing keys; true when the key was one of them */
  keyDown(event: KeyboardEvent): boolean {
    const ctrl = event.ctrlKey || event.metaKey;
    if (ctrl && event.code === 'KeyZ') {
      if (event.shiftKey) this.redo();
      else this.undo();
      return true;
    }
    if (ctrl && event.code === 'KeyY') {
      this.redo();
      return true;
    }
    if (ctrl) return false;
    if (event.code === 'KeyG') {
      this.setMode('move');
      return true;
    }
    if (event.code === 'KeyR') {
      this.setMode('rotate');
      return true;
    }
    if (event.code === 'Delete') {
      this.#deletePoint();
      return true;
    }
    return false;
  }

  undo(): void {
    const edit = this.#history.undo();
    if (edit) this.#apply(edit);
  }

  redo(): void {
    const edit = this.#history.redo();
    if (edit) this.#apply(edit);
  }

  /** Every frame: keeps the gizmo on what is selected, which a redraw replaces with a new object */
  update(): void {
    if (this.#gizmo.dragging) return;
    const selected = this.#selected;
    const object = !selected
      ? null
      : this.#point !== null
        ? this.#world.routeBall(selected.guid, this.#point)
        : this.#world.findSpawn(selected.kind, selected.guid);
    if (!object) {
      if (this.#gizmo.target) this.#gizmo.detach();
      return;
    }
    if (this.#gizmo.target?.object !== object) {
      this.#gizmo.attach({ object, turns: this.#point !== null ? 'none' : selected!.kind === 'creature' ? 'z' : 'all' });
      this.#gizmo.setMode(this.#mode);
    }
  }

  dispose(): void {
    this.#history.clear();
    this.#gizmo.dispose();
  }

  /** The selected spawn as an edit names it, read from what is drawn */
  #ref(): SpawnRef | null {
    const selected = this.#selected;
    const data = selected ? this.#world.findSpawn(selected.kind, selected.guid)?.userData.spawn : null;
    return data ? { kind: data.kind, guid: data.guid, entry: data.entry, own: data.own } : null;
  }

  #started(): void {
    const selected = this.#selected;
    const target = this.#gizmo.target;
    if (!selected || !target) return;
    if (this.#point !== null) {
      this.#before = this.#world.spawnRoute(selected.guid)?.points.map((p) => ({ ...p })) ?? null;
    } else {
      this.#before = placementOf(target.object, selected.kind);
    }
  }

  async #ended(lifted: boolean): Promise<void> {
    const selected = this.#selected;
    const target = this.#gizmo.target?.object;
    const before = this.#before;
    this.#before = null;
    if (!selected || !target || !before) return;

    // Dropped along the ground: onto the server's floor nearest where it was dragged, when it has one
    const { x, y } = target.position;
    let z = target.position.z;
    if (!lifted && this.#mode === 'move' && this.#options.floorZ) {
      const floor = await this.#options.floorZ(x, y, z);
      if (floor === null) {
        this.#options.onNotice?.(NOT_SNAPPED);
      } else {
        z = floor;
        this.#options.onNotice?.(null);
      }
      target.position.z = z;
      target.updateMatrixWorld(true);
    }

    if (Array.isArray(before)) {
      const index = this.#point;
      if (index === null) return;
      const points = before.map((p, i) => (i === index ? { ...p, x, y, z } : p));
      await this.#routeEdit(before, points);
      return;
    }
    const spawn = this.#ref();
    if (!spawn) return;
    const after: SpawnEdit = { kind: 'place', spawn, to: placementOf(target, selected.kind) };
    this.#history.push({ kind: 'place', spawn, to: before }, after);
    this.#options.onEdit?.(after);
  }

  #deletePoint(): void {
    const selected = this.#selected;
    const index = this.#point;
    if (!selected || index === null) return;
    const route = this.#world.spawnRoute(selected.guid);
    if (!route) return;
    const points = withoutPoint(route.points, index);
    if (!points) {
      this.#options.onNotice?.(TOO_SHORT);
      return;
    }
    this.#point = null;
    void this.#routeEdit(route.points, points);
  }

  /** A changed route: asked about first when others walk it, then drawn, remembered and emitted */
  async #routeEdit(before: EditPoint[], after: EditPoint[]): Promise<void> {
    const selected = this.#selected;
    const spawn = this.#ref();
    const route = selected ? this.#world.spawnRoute(selected.guid) : null;
    if (!selected || !spawn || !route) return;
    if (!spawn.own) {
      let answer = this.#answers.get(route.pathId);
      if (!answer) {
        answer = this.#options.beforeRouteEdit?.(spawn, route.pathId) ?? Promise.resolve(true);
        this.#answers.set(route.pathId, answer);
      }
      if (!(await answer)) {
        this.#world.setPendingRoute(selected.guid, before);
        this.#point = null;
        return;
      }
    }
    const edit: SpawnEdit = { kind: 'route', spawn, pathId: route.pathId, points: after };
    this.#history.push({ ...edit, points: before }, edit);
    this.#world.setPendingRoute(selected.guid, after);
    this.#options.onEdit?.(edit);
  }

  /** An undone or redone edit: drawn at once, and sent on like any other */
  #apply(edit: SpawnEdit): void {
    if (edit.kind === 'place') {
      const object = this.#world.findSpawn(edit.spawn.kind, edit.spawn.guid);
      if (object) {
        object.position.set(edit.to.x, edit.to.y, edit.to.z);
        object.quaternion.copy(quaternionOf(edit.to));
        object.updateMatrixWorld(true);
        if (this.#gizmo.target?.object === object) this.#gizmo.attach(this.#gizmo.target);
      }
    } else {
      this.#point = null;
      this.#world.setPendingRoute(edit.spawn.guid, edit.points);
    }
    this.#options.onEdit?.(edit);
  }
}
