import * as THREE from 'three';
import { Gizmo, type GizmoChange } from '../edit/Gizmo';
import { textLabel } from './label';

/**
 * The open quest's positions in the 3D view: a pin over each scene step point, escort point and fight
 * summon point, a ring round an areatrigger's area and a POI's outline on the ground, each labelled and
 * coloured by kind. One can be selected; a draggable one then gets move handles of its own, and where it
 * is let go is reported, for the host to store. Nothing here knows what a marker means.
 */

type At = { x: number; y: number; z: number };

export interface MarkerDrawing extends At {
  id: string;
  /** What it is, for its colour */
  kind: string;
  label: string;
  draggable: boolean;
  /** An area's radius, in yards */
  radius?: number;
  /** A POI's outline on the ground */
  outline?: { x: number; y: number }[];
}

export interface MarkerEvents {
  /** A marker was dragged and let go here; `lifted` when it was raised on the Z arrow, which keeps its height */
  moved(id: string, to: At, lifted: boolean): void | Promise<void>;
}

const KIND_COLOURS: Record<string, number> = {
  scenePoint: 0x6fd08c,
  escortPoint: 0x5db8f0,
  fightPoint: 0xf07a6a,
  area: 0xc08cf0,
  poi: 0xf5b041,
};
const OTHER_COLOUR = 0xdddddd;
const SELECTED_COLOUR = 0xffd34d;
/** How far above its point a pin floats, and how big it is, in yards */
const PIN_HEIGHT = 2.2;
const PIN_SIZE = 0.6;
/** How close a click's ray must pass to a pin: a yard, or more the further away it is */
const PICK_NEAR = 1;
const PICK_SHARE = 0.015;
const RING_SEGMENTS = 64;
const RING_LIFT = 0.2;
/** How high up the ground under a POI is looked for, and how often (in frames) an outline not yet on it is tried again */
const PROBE_FROM = 4000;
const SETTLE_EVERY = 30;

const circle = new THREE.BufferGeometry().setFromPoints(
  Array.from({ length: RING_SEGMENTS }, (_, i) => new THREE.Vector3(Math.cos((i / RING_SEGMENTS) * Math.PI * 2), Math.sin((i / RING_SEGMENTS) * Math.PI * 2), 0)),
);
const pinGeometry = new THREE.OctahedronGeometry(PIN_SIZE);
const stemGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, PIN_HEIGHT)]);
const SHARED = new Set<THREE.BufferGeometry>([circle, pinGeometry, stemGeometry]);

/** One drawn marker: its group (at its point) and the material its colour shows in */
type Drawn = { drawing: MarkerDrawing; group: THREE.Group; colour: THREE.MeshBasicMaterial; settled: boolean };

export class MarkerLayer {
  readonly #root = new THREE.Group();
  readonly #gizmo: Gizmo;
  readonly #ground: () => THREE.Object3D[];
  readonly #events: MarkerEvents;
  readonly #down = new THREE.Raycaster();
  #drawn = new Map<string, Drawn>();
  #selected: string | null = null;
  #drag: { id: string; start: THREE.Vector3; last: GizmoChange | null } | null = null;
  #frame = 0;

  constructor(camera: THREE.Camera, dom: HTMLElement, scene: THREE.Scene, ground: () => THREE.Object3D[], events: MarkerEvents) {
    this.#root.name = 'quest-markers';
    this.#ground = ground;
    this.#events = events;
    scene.add(this.#root);
    this.#gizmo = new Gizmo(camera, dom, scene, ground, {
      started: () => this.#started(),
      moved: (change) => this.#moved(change),
      ended: (lifted) => this.#ended(lifted),
    });
  }

  get selected(): string | null {
    return this.#selected;
  }

  /** Whether a press is the handles', so the camera leaves it alone */
  get blocked(): boolean {
    return this.#gizmo.hovered || this.#gizmo.dragging;
  }

  get dragging(): boolean {
    return this.#gizmo.dragging || this.#drag !== null;
  }

  /** Draws these markers in place of the last; the selected one stays selected while it is among them */
  set(markers: readonly MarkerDrawing[]): void {
    for (const drawn of this.#drawn.values()) this.#free(drawn.group);
    this.#root.clear();
    this.#drawn = new Map(markers.map((m) => [m.id, this.#draw(m)]));
    // A drag under way goes on with the marker drawn anew (the handles are where the pointer has them)
    const drag = this.#drag;
    if (drag && this.#drawn.has(drag.id)) {
      this.#paint(drag.id);
      if (drag.last) this.#moved(drag.last);
      return;
    }
    this.#drag = null;
    this.select(this.#selected);
  }

  /** The marker whose pin a ray passes nearest, close enough to count; null for none */
  pick(ray: THREE.Ray): string | null {
    let best: { id: string; along: number } | null = null;
    const pin = new THREE.Vector3();
    for (const { drawing, group } of this.#drawn.values()) {
      pin.set(group.position.x, group.position.y, group.position.z + PIN_HEIGHT);
      const along = ray.origin.distanceTo(pin);
      const near = Math.max(PICK_NEAR, along * PICK_SHARE);
      if (ray.distanceSqToPoint(pin) > near * near) continue;
      if (!best || along < best.along) best = { id: drawing.id, along };
    }
    return best?.id ?? null;
  }

  /** Selects a marker (its handles on it when it can be dragged), or none; false when there is no such marker */
  select(id: string | null): boolean {
    const next = id === null ? undefined : this.#drawn.get(id);
    this.#paint(next ? next.drawing.id : null);
    if (!next) {
      this.#gizmo.detach();
      return id === null;
    }
    if (next.drawing.draggable) {
      this.#gizmo.attach(next.group.position.clone(), new THREE.Quaternion(), 'none');
      this.#gizmo.setMode('move');
    } else {
      this.#gizmo.detach();
    }
    return true;
  }

  /** Shows which marker is selected, in the selection's colour */
  #paint(id: string | null): void {
    const was = this.#selected === null ? undefined : this.#drawn.get(this.#selected);
    if (was) was.colour.color.setHex(colourOf(was.drawing));
    this.#selected = id;
    if (id !== null) this.#drawn.get(id)?.colour.color.setHex(SELECTED_COLOUR);
  }

  /** Every frame: an outline not yet on the ground is put on it once the ground under it is drawn */
  update(): void {
    this.#frame += 1;
    if (this.#frame % SETTLE_EVERY !== 1) return;
    for (const drawn of this.#drawn.values()) if (!drawn.settled) this.#settle(drawn);
  }

  dispose(): void {
    this.#gizmo.dispose();
    for (const drawn of this.#drawn.values()) this.#free(drawn.group);
    this.#drawn.clear();
    this.#root.removeFromParent();
  }

  #draw(drawing: MarkerDrawing): Drawn {
    const group = new THREE.Group();
    group.name = drawing.id;
    group.position.set(drawing.x, drawing.y, drawing.z);
    const tint = colourOf(drawing);
    const colour = new THREE.MeshBasicMaterial({ color: tint, depthTest: false });
    const line = new THREE.LineBasicMaterial({ color: tint, depthTest: false });
    const pin = new THREE.Mesh(pinGeometry, colour);
    pin.position.z = PIN_HEIGHT;
    pin.renderOrder = 3;
    const stem = new THREE.Line(stemGeometry, line);
    stem.renderOrder = 3;
    group.add(pin, stem);
    if (drawing.radius) {
      const ring = new THREE.LineLoop(circle, line);
      ring.name = 'radius';
      ring.position.z = RING_LIFT;
      ring.scale.set(drawing.radius, drawing.radius, 1);
      ring.renderOrder = 3;
      group.add(ring);
    }
    if (drawing.outline) {
      const outline = new THREE.LineLoop(new THREE.BufferGeometry(), line);
      outline.name = 'outline';
      outline.renderOrder = 3;
      group.add(outline);
    }
    const label = textLabel(drawing.label, tint);
    if (label) {
      label.position.z = PIN_HEIGHT + PIN_SIZE;
      group.add(label);
    }
    this.#root.add(group);
    group.updateMatrixWorld(true);
    const drawn = { drawing, group, colour, settled: !drawing.outline };
    if (drawing.outline) this.#settle(drawn);
    return drawn;
  }

  /**
   * A POI's outline on the drawn ground (its rows have no height): the group stands on the ground at its
   * middle, and each corner on the ground under it. Until the ground there is drawn, it lies flat at the
   * group's height.
   */
  #settle(drawn: Drawn): void {
    const { group, drawing } = drawn;
    const outline = group.getObjectByName('outline') as THREE.LineLoop | undefined;
    if (!outline || !drawing.outline) return;
    const middle = this.#groundAt(drawing.x, drawing.y);
    const corners = drawing.outline.map((p) => ({ ...p, z: this.#groundAt(p.x, p.y) }));
    drawn.settled = middle !== null && corners.every((c) => c.z !== null);
    if (middle !== null) group.position.z = middle;
    const base = group.position.z;
    outline.geometry.dispose();
    outline.geometry = new THREE.BufferGeometry().setFromPoints(corners.map((c) => new THREE.Vector3(c.x - group.position.x, c.y - group.position.y, (c.z ?? base) + RING_LIFT - base)));
    group.updateMatrixWorld(true);
  }

  #groundAt(x: number, y: number): number | null {
    this.#down.set(new THREE.Vector3(x, y, PROBE_FROM), new THREE.Vector3(0, 0, -1));
    this.#down.far = PROBE_FROM * 2;
    return this.#down.intersectObjects(this.#ground(), true)[0]?.point.z ?? null;
  }

  #free(group: THREE.Group): void {
    group.traverse((object) => {
      const drawn = object as THREE.Mesh;
      // Every sprite shares Three's one quad
      if (drawn.geometry && !SHARED.has(drawn.geometry) && !(object instanceof THREE.Sprite)) drawn.geometry.dispose();
      const material = drawn.material as THREE.Material | undefined;
      if (material && 'map' in material) (material.map as THREE.Texture | null)?.dispose();
      material?.dispose();
    });
  }

  #started(): void {
    const drawn = this.#selected === null ? undefined : this.#drawn.get(this.#selected);
    this.#drag = drawn ? { id: drawn.drawing.id, start: drawn.group.position.clone(), last: null } : null;
  }

  #moved(change: GizmoChange): void {
    const drag = this.#drag;
    const group = drag && this.#drawn.get(drag.id)?.group;
    if (!drag || !group) return;
    drag.last = change;
    group.position.copy(drag.start).add(change.delta);
    group.updateMatrixWorld(true);
  }

  async #ended(lifted: boolean): Promise<void> {
    const drag = this.#drag;
    this.#drag = null;
    if (!drag?.last || drag.last.delta.lengthSq() === 0) return;
    const to = drag.start.clone().add(drag.last.delta);
    await this.#events.moved(drag.id, { x: to.x, y: to.y, z: to.z }, lifted);
  }
}

const colourOf = (drawing: MarkerDrawing): number => KIND_COLOURS[drawing.kind] ?? OTHER_COLOUR;
