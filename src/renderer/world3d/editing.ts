import * as THREE from 'three';
import type { Placement } from '@core/world/layer';
import type { EditPoint, SpawnEdit, SpawnRef } from './edits';
import { Gizmo, placementOf, quaternionOf, type GizmoChange, type GizmoMode, type GizmoTurns } from './scene/edit/Gizmo';
import { createHistory } from './scene/edit/history';
import { legIndex, MIN_ROUTE_POINTS } from './scene/edit/route';
import { afterRouteChange, EMPTY_SELECTION, type Selection } from './scene/edit/selection';
import { FALLOFF_DEFAULT, falloffWeights, stepRadius, type Falloff } from './scene/edit/falloff';
import { centreOf, movedBy, turnedAbout, turnQuaternion } from './scene/edit/group';

/**
 * Editing in the 3D view: one gizmo on the middle of what is selected (NPCs, objects, points of
 * routes), moving or turning all of it together; with falloff, the other points of those routes
 * nearby follow by a share. Delete takes picked points out, a click inserts one, and undo goes back
 * a whole gesture at a time. Every edit is emitted as a whole placement or a whole route, for the
 * view's host to store; the world draws it at once and keeps it until the host says.
 */

export const NOT_SNAPPED = 'The height is from the drawn ground, not the server.';
export const TOO_SHORT = 'A route keeps at least two points.';
export const PICK_POINT_FIRST = 'Pick a point of the route first, or click on one of its legs.';

type Kind = 'creature' | 'object';
type At = { x: number; y: number; z: number };

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
  /** Draws a route as edited until the host stores it */
  setPendingRoute(guid: number, points: EditPoint[]): void;
  /** Moves a drawn route to points being dragged */
  previewRoute(guid: number, points: EditPoint[]): void;
}

export interface EditingOptions {
  onEdit?(edit: SpawnEdit): void;
  /** The server's floor nearest a height at a place, or null when it has none there */
  floorZ?(x: number, y: number, nearZ: number): Promise<number | null>;
  /** Asked once per route before the first change to a world route; false leaves it as it was */
  beforeRouteEdit?(spawn: SpawnRef, pathId: number): Promise<boolean>;
  onNotice?(message: string | null): void;
  /** Told when the editor itself changed the selection (a delete or an insert) */
  onSelection?(selection: Selection): void;
  /** Told when falloff was switched or its radius changed by a key or the wheel */
  onFalloff?(falloff: Falloff): void;
}

/** A spawn being dragged, as it stood when the drag began */
type DraggedSpawn = { kind: Kind; guid: number; start: THREE.Vector3; quaternion: THREE.Quaternion; before: Placement };
/** A route with picked points being dragged: its points as they stood, and as they are now */
type DraggedRoute = { guid: number; before: EditPoint[]; current: EditPoint[]; picked: Set<number> };

type Drag = {
  spawns: DraggedSpawn[];
  routes: DraggedRoute[];
  centre: THREE.Vector3;
  /** Each falloff point's share of a move, by `guid:index` */
  weights: Map<string, number>;
  last: GizmoChange | null;
};

const pointKey = (guid: number, index: number) => `${guid}:${index}`;

/** Which of a route's points are picked */
const pickedOf = (selection: Selection, guid: number) => new Set(selection.points.filter((p) => p.guid === guid).map((p) => p.index));

export class Editor {
  readonly #world: EditingWorld;
  readonly #options: EditingOptions;
  readonly #gizmo: Gizmo;
  readonly #history = createHistory();
  /** Each world route's answer to "change it for every spawn that walks it?" */
  readonly #answers = new Map<number, Promise<boolean>>();
  #selection: Selection = EMPTY_SELECTION;
  #falloff: Falloff = { on: false, radius: FALLOFF_DEFAULT };
  #mode: GizmoMode = 'move';
  #drag: Drag | null = null;
  /** Where the gizmo was last put, so it is put again only when that changes */
  #attached: { at: THREE.Vector3; quaternion: THREE.Quaternion; turns: GizmoTurns } | null = null;

  constructor(world: EditingWorld, options: EditingOptions) {
    this.#world = world;
    this.#options = options;
    this.#gizmo = new Gizmo(world.camera, world.dom, world.scene, world.ground, {
      started: () => this.#started(),
      moved: (change) => this.#moved(change),
      ended: (lifted) => this.#ended(lifted),
    });
  }

  /** Whether a press is the gizmo's, so the camera leaves it alone */
  get blocked(): boolean {
    return this.#gizmo.hovered || this.#gizmo.dragging;
  }

  get selection(): Selection {
    return this.#selection;
  }

  /** What the host selected; the editor tells it back only about changes it makes itself */
  setSelection(selection: Selection): void {
    this.#selection = selection;
  }

  get falloff(): Falloff {
    return this.#falloff;
  }

  setFalloff(falloff: Falloff): void {
    this.#falloff = { ...falloff };
  }

  setMode(mode: GizmoMode): void {
    this.#mode = mode;
    this.#gizmo.setMode(mode);
  }

  /**
   * A new route point where a click lands (Shift-click in Camera mode, Alt-click in Select mode): on
   * the nearest leg of an active route, else after the last picked point. True when the click was used.
   */
  insertPoint(ndcX: number, ndcY: number): boolean {
    const { routes, points } = this.#selection;
    if (routes.length === 0) return false;
    const ground = this.#world.pickGround(ndcX, ndcY);
    if (!ground) return true;

    let target: { guid: number; index: number } | null = null;
    for (const guid of routes) {
      const route = this.#world.spawnRoute(guid);
      const index = route ? legIndex(route.points, ground) : null;
      if (index !== null) {
        target = { guid, index };
        break;
      }
    }
    if (!target && routes.length === 1) {
      const guid = routes[0]!;
      const route = this.#world.spawnRoute(guid);
      const last = points.filter((p) => p.guid === guid).at(-1);
      if (route) target = { guid, index: last ? last.index + 1 : route.points.length };
    }
    if (!target && points.length > 0) {
      const last = points.at(-1)!;
      target = { guid: last.guid, index: last.index + 1 };
    }
    if (!target) {
      this.#options.onNotice?.(PICK_POINT_FIRST);
      return true;
    }

    const route = this.#world.spawnRoute(target.guid);
    if (!route) return true;
    const { guid, index } = target;
    const after = [...route.points.slice(0, index), { x: ground.x, y: ground.y, z: ground.z }, ...route.points.slice(index)];
    const moved = afterRouteChange(this.#selection, guid, { kind: 'insert', index });
    this.#select({ ...moved, points: [{ guid, index }] });
    void this.#commit([this.#routeEdit(guid, route.points)], [this.#routeEdit(guid, after)]);
    return true;
  }

  /** A wheel turn during a falloff drag grows or shrinks the radius; true when it was used */
  wheel(deltaY: number): boolean {
    const drag = this.#drag;
    if (!drag || !this.#falloff.on || this.#selection.points.length === 0) return false;
    this.#setFalloff({ ...this.#falloff, radius: stepRadius(this.#falloff.radius, deltaY < 0 ? 1 : -1) });
    drag.weights = this.#weights(drag.routes);
    if (drag.last) this.#moved(drag.last);
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
    switch (event.code) {
      case 'KeyG':
        this.setMode('move');
        return true;
      case 'KeyR':
        this.setMode('rotate');
        return true;
      case 'Delete':
        this.#deletePoints();
        return true;
      case 'KeyO':
        this.#setFalloff({ ...this.#falloff, on: !this.#falloff.on });
        return true;
      case 'BracketRight':
        this.#setFalloff({ ...this.#falloff, radius: stepRadius(this.#falloff.radius, 1) });
        return true;
      case 'BracketLeft':
        this.#setFalloff({ ...this.#falloff, radius: stepRadius(this.#falloff.radius, -1) });
        return true;
    }
    return false;
  }

  undo(): void {
    for (const edit of this.#history.undo() ?? []) this.#apply(edit);
  }

  redo(): void {
    for (const edit of this.#history.redo() ?? []) this.#apply(edit);
  }

  /** Every frame: keeps the gizmo on the middle of what is selected, which a redraw may have replaced */
  update(): void {
    if (this.#drag || this.#gizmo.dragging) return;
    const spawns = this.#selection.spawns.flatMap((s) => {
      const object = this.#world.findSpawn(s.kind, s.guid);
      return object ? [{ kind: s.kind, object }] : [];
    });
    const points = this.pointPositions();
    if (spawns.length + points.length === 0) {
      if (this.#gizmo.attached) this.#gizmo.detach();
      this.#attached = null;
      return;
    }
    const at = centreOf([...spawns.map((s) => s.object.position), ...points]);
    const centre = new THREE.Vector3(at.x, at.y, at.z);
    const single = spawns.length === 1 && points.length === 0 ? spawns[0]! : null;
    const turns: GizmoTurns = single?.kind === 'object' ? 'all' : spawns.length === 0 && this.#mode === 'move' ? 'none' : 'z';
    const quaternion = single ? single.object.quaternion.clone() : new THREE.Quaternion();
    const was = this.#attached;
    if (was && was.turns === turns && was.at.distanceTo(centre) < 1e-6 && was.quaternion.angleTo(quaternion) < 1e-6 && this.#gizmo.attached) return;
    this.#attached = { at: centre, quaternion, turns };
    this.#gizmo.attach(centre, quaternion, turns);
    this.#gizmo.setMode(this.#mode);
  }

  dispose(): void {
    this.#history.clear();
    this.#gizmo.dispose();
  }

  /** Where the picked points are drawn: where a drag has them, else as the route has them */
  pointPositions(): At[] {
    const drag = this.#drag;
    return this.#selection.points.flatMap((p) => {
      const dragged = drag?.routes.find((r) => r.guid === p.guid)?.current[p.index];
      if (dragged) return [{ x: dragged.x, y: dragged.y, z: dragged.z }];
      const point = this.#world.spawnRoute(p.guid)?.points[p.index];
      return point ? [{ x: point.x, y: point.y, z: point.z }] : [];
    });
  }

  #select(selection: Selection): void {
    this.#selection = selection;
    this.#options.onSelection?.(selection);
  }

  #setFalloff(falloff: Falloff): void {
    this.#falloff = falloff;
    this.#options.onFalloff?.({ ...falloff });
  }

  /** An NPC's spawn as an edit names it, read from what is drawn */
  #ref(kind: Kind, guid: number): SpawnRef | null {
    const data = this.#world.findSpawn(kind, guid)?.userData.spawn;
    return data ? { kind: data.kind, guid: data.guid, entry: data.entry, own: data.own } : null;
  }

  /** A route edit for an NPC's route; callers check first that the NPC and its route are drawn */
  #routeEdit(guid: number, points: EditPoint[]): SpawnEdit {
    const spawn = this.#ref('creature', guid)!;
    const route = this.#world.spawnRoute(guid)!;
    return { kind: 'route', spawn, pathId: route.pathId, points };
  }

  /** Each other point of the dragged routes' share of a move, with falloff on */
  #weights(routes: DraggedRoute[]): Map<string, number> {
    if (!this.#falloff.on || this.#mode !== 'move') return new Map();
    const selected = routes.flatMap((r) => r.before.filter((_, i) => r.picked.has(i)));
    const others = routes.flatMap((r) => r.before.flatMap((p, i) => (r.picked.has(i) ? [] : [{ key: pointKey(r.guid, i), x: p.x, y: p.y }])));
    return falloffWeights(selected, others, this.#falloff.radius);
  }

  #started(): void {
    const spawns = this.#selection.spawns.flatMap((s): DraggedSpawn[] => {
      const object = this.#world.findSpawn(s.kind, s.guid);
      return object ? [{ kind: s.kind, guid: s.guid, start: object.position.clone(), quaternion: object.quaternion.clone(), before: placementOf(object, s.kind) }] : [];
    });
    const guids = [...new Set(this.#selection.points.map((p) => p.guid))];
    const routes = guids.flatMap((guid): DraggedRoute[] => {
      const route = this.#world.spawnRoute(guid);
      if (!route || !this.#ref('creature', guid)) return [];
      const before = route.points.map((p) => ({ ...p }));
      return [{ guid, before, current: before, picked: pickedOf(this.#selection, guid) }];
    });
    const centre = this.#attached?.at.clone() ?? new THREE.Vector3();
    this.#drag = { spawns, routes, centre, weights: this.#weights(routes), last: null };
  }

  /** The drag so far, applied to everything selected (found again by guid: a redraw may have replaced it) */
  #moved(change: GizmoChange): void {
    const drag = this.#drag;
    if (!drag) return;
    drag.last = change;
    const turning = this.#mode === 'rotate' && this.#attached?.turns !== 'none';
    const onGround = (p: At): At => {
      if (turning || change.axis === 'Z') return p;
      return { ...p, z: this.#gizmo.groundAt(p.x, p.y, p.z) ?? p.z };
    };
    const moved = (start: At, weight: number): At => (turning ? turnedAbout(start, drag.centre, change.angle) : onGround(movedBy(start, change.delta, weight)));

    for (const spawn of drag.spawns) {
      const object = this.#world.findSpawn(spawn.kind, spawn.guid);
      if (!object) continue;
      const to = moved(spawn.start, 1);
      object.position.set(to.x, to.y, to.z);
      if (turning) {
        const q = this.#attached?.turns === 'all' ? change.quaternion : new THREE.Quaternion(...turnQuaternion(spawn.quaternion.toArray() as [number, number, number, number], change.angle));
        object.quaternion.copy(q);
      }
      object.updateMatrixWorld(true);
    }

    for (const route of drag.routes) {
      route.current = route.before.map((p, i) => {
        const weight = route.picked.has(i) ? 1 : turning ? 0 : (drag.weights.get(pointKey(route.guid, i)) ?? 0);
        return weight === 0 ? p : { ...p, ...moved(p, weight) };
      });
      this.#world.previewRoute(route.guid, route.current);
    }
  }

  async #ended(lifted: boolean): Promise<void> {
    const drag = this.#drag;
    this.#drag = null;
    const change = drag?.last;
    if (!drag || !change || (change.delta.lengthSq() === 0 && change.angle === 0)) return;
    const moving = this.#mode === 'move' || this.#attached?.turns === 'none';

    const spawns = drag.spawns.flatMap((s) => {
      const object = this.#world.findSpawn(s.kind, s.guid);
      return object ? [{ ...s, object }] : [];
    });
    const routes = drag.routes.map((r) => ({ ...r, changed: r.current.flatMap((p, i) => (p === r.before[i] ? [] : [i])) }));

    // Dropped along the ground: onto the server's floor nearest where each thing was dragged, when it has one
    if (moving && !lifted && this.#options.floorZ) {
      const floorZ = this.#options.floorZ;
      const asks = [
        ...spawns.map(async (s) => {
          const floor = await floorZ(s.object.position.x, s.object.position.y, s.object.position.z);
          if (floor !== null) s.object.position.z = floor;
          return floor !== null;
        }),
        ...routes.flatMap((r) =>
          r.changed.map(async (i) => {
            const p = r.current[i]!;
            const floor = await floorZ(p.x, p.y, p.z);
            if (floor !== null) r.current[i] = { ...p, z: floor };
            return floor !== null;
          }),
        ),
      ];
      const unfloored = (await Promise.all(asks)).filter((found) => !found).length;
      this.#options.onNotice?.(unfloored === 0 ? null : unfloored === 1 ? NOT_SNAPPED : `${unfloored} of them: the height is from the drawn ground, not the server.`);
    }

    const before: SpawnEdit[] = [];
    const after: SpawnEdit[] = [];
    for (const s of spawns) {
      // A move puts the NPC where it was dragged to, so what it was lifted onto the ground by no longer applies
      if (moving) s.object.userData.lift = 0;
      s.object.updateMatrixWorld(true);
      const spawn = this.#ref(s.kind, s.guid);
      if (!spawn) continue;
      before.push({ kind: 'place', spawn, to: s.before });
      after.push({ kind: 'place', spawn, to: placementOf(s.object, s.kind) });
    }
    for (const r of routes) {
      if (r.changed.length === 0 || !this.#ref('creature', r.guid)) continue;
      before.push(this.#routeEdit(r.guid, r.before));
      after.push(this.#routeEdit(r.guid, r.current));
    }
    await this.#commit(before, after);
  }

  /** Delete: every picked point out of its route; a route that would be too short to walk is left as it was */
  #deletePoints(): void {
    let selection = this.#selection;
    const before: SpawnEdit[] = [];
    const after: SpawnEdit[] = [];
    for (const guid of [...new Set(selection.points.map((p) => p.guid))]) {
      const route = this.#world.spawnRoute(guid);
      if (!route || !this.#ref('creature', guid)) continue;
      const picked = pickedOf(selection, guid);
      const left = route.points.filter((_, i) => !picked.has(i));
      if (left.length < MIN_ROUTE_POINTS) {
        this.#options.onNotice?.(TOO_SHORT);
        continue;
      }
      selection = afterRouteChange(selection, guid, { kind: 'delete', indexes: [...picked] });
      before.push(this.#routeEdit(guid, route.points));
      after.push(this.#routeEdit(guid, left));
    }
    if (after.length === 0) return;
    this.#select(selection);
    void this.#commit(before, after);
  }

  /**
   * One gesture's edits: a world route others walk is asked about first (one question at a time, once
   * per route); one answered no is drawn back and left out. The rest are drawn, remembered as one
   * undo step and emitted.
   */
  async #commit(before: SpawnEdit[], after: SpawnEdit[]): Promise<void> {
    const kept: number[] = [];
    for (let i = 0; i < after.length; i++) {
      const edit = after[i]!;
      if (edit.kind === 'route' && !edit.spawn.own) {
        let answer = this.#answers.get(edit.pathId);
        if (!answer) {
          answer = this.#options.beforeRouteEdit?.(edit.spawn, edit.pathId) ?? Promise.resolve(true);
          this.#answers.set(edit.pathId, answer);
        }
        if (!(await answer)) {
          const was = before[i]!;
          if (was.kind === 'route') this.#world.setPendingRoute(was.spawn.guid, was.points);
          continue;
        }
      }
      kept.push(i);
    }
    if (kept.length === 0) return;
    const done = kept.map((i) => after[i]!);
    for (const edit of done) if (edit.kind === 'route') this.#world.setPendingRoute(edit.spawn.guid, edit.points);
    this.#history.push(kept.map((i) => before[i]!), done);
    for (const edit of done) this.#options.onEdit?.(edit);
  }

  /** An undone or redone edit: drawn at once, and sent on like any other */
  #apply(edit: SpawnEdit): void {
    if (edit.kind === 'place') {
      const object = this.#world.findSpawn(edit.spawn.kind, edit.spawn.guid);
      if (object) {
        object.position.set(edit.to.x, edit.to.y, edit.to.z);
        object.quaternion.copy(quaternionOf(edit.to));
        object.updateMatrixWorld(true);
      }
    } else {
      // The route's points may have changed under its picked ones
      if (this.#selection.points.some((p) => p.guid === edit.spawn.guid)) {
        this.#select({ ...this.#selection, points: this.#selection.points.filter((p) => p.guid !== edit.spawn.guid) });
      }
      this.#world.setPendingRoute(edit.spawn.guid, edit.points);
    }
    this.#options.onEdit?.(edit);
  }
}
