import { NODE_STOP, type TaxiNode } from '../game/taxi-path';
import type { Placement } from '../world/layer';

/** Where a vessel is and which way its local x axis points (radians, 0 = +x); see `frameAt` for how that relates to its travel. */
export interface Frame {
  x: number;
  y: number;
  z: number;
  heading: number;
}

type Point = { x: number; y: number; z: number };
type Rotation = NonNullable<Placement['rotation']>;

export const IDENTITY_FRAME: Frame = { x: 0, y: 0, z: 0, heading: 0 };

const TAU = 2 * Math.PI;

/**
 * The vessel's frame at a node, as the server poses it (`TransportMgr::GeneratePath`): the route's direction there
 * (the spline's, from the previous node to the next; at an end, along its one neighbour; only nodes on the same map
 * count), turned by pi, since a vessel's local x points against its travel. A lone node faces 0.
 */
export function frameAt(nodes: readonly TaxiNode[], index: number): Frame {
  const node = nodes[index];
  if (!node) return IDENTITY_FRAME;
  const near = (other: TaxiNode | undefined): TaxiNode => (other && other.map === node.map ? other : node);
  const from = near(nodes[index - 1]);
  const to = near(nodes[index + 1]);
  const heading = from === to ? 0 : wrap(Math.atan2(to.y - from.y, to.x - from.x) + Math.PI);
  return { x: node.x, y: node.y, z: node.z, heading };
}

function turn(p: Point, heading: number): Point {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c, z: p.z };
}

export function toWorld(frame: Frame, local: Point): Point {
  const r = turn(local, frame.heading);
  return { x: frame.x + r.x, y: frame.y + r.y, z: frame.z + r.z };
}

export function toLocal(frame: Frame, world: Point): Point {
  return turn({ x: world.x - frame.x, y: world.y - frame.y, z: world.z - frame.z }, -frame.heading);
}

/** `q` turned about Z by `angle` (that turn's quaternion times `q`); an all-zero `q` counts as upright. */
function turnRotation(q: Rotation, angle: number): Rotation {
  const [x, y, z, w] = q[0] === 0 && q[1] === 0 && q[2] === 0 && q[3] === 0 ? [0, 0, 0, 1] : q;
  const s = Math.sin(angle / 2);
  const c = Math.cos(angle / 2);
  return [c * x - s * y, c * y + s * x, c * z + s * w, c * w - s * z];
}

const wrap = (angle: number): number => ((angle % TAU) + TAU) % TAU;

export function placementToWorld(frame: Frame, p: Placement): Placement {
  return { ...toWorld(frame, p), orientation: wrap(p.orientation + frame.heading), rotation: p.rotation && turnRotation(p.rotation, frame.heading) };
}

export function placementToLocal(frame: Frame, p: Placement): Placement {
  return { ...toLocal(frame, p), orientation: wrap(p.orientation - frame.heading), rotation: p.rotation && turnRotation(p.rotation, -frame.heading) };
}

/** Maximal runs of consecutive nodes on one map, in path order. */
export function hostRuns(nodes: readonly TaxiNode[]): { map: number; nodes: TaxiNode[] }[] {
  const runs: { map: number; nodes: TaxiNode[] }[] = [];
  for (const node of nodes) {
    const last = runs[runs.length - 1];
    if (last && last.map === node.map) last.nodes.push(node);
    else runs.push({ map: node.map, nodes: [node] });
  }
  return runs;
}

/** Index of the first stop on a drawable map, else the first node on one, else -1. */
export function defaultNode(nodes: readonly TaxiNode[], drawable: (map: number) => boolean): number {
  const stop = nodes.findIndex((n) => n.flags & NODE_STOP && drawable(n.map));
  return stop >= 0 ? stop : nodes.findIndex((n) => drawable(n.map));
}
