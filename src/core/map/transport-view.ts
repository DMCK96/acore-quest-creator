import { NODE_STOP, type TaxiNode } from '../game/taxi-path';
import { defaultNode, frameAt, hostRuns, type Frame } from './transport-frame';
import type { TransportTemplate } from './transports';
import type { WorldMap } from './world-maps';

/** Which transport template and which node of its route the World shows; `node` indexes that template's path. */
export interface TransportView {
  template: number;
  node: number;
}

export interface RouteLine {
  points: { x: number; y: number; z: number }[];
  stops: { node: number; x: number; y: number; z: number }[];
}

export interface NodeOption {
  node: number;
  label: string;
  stop: boolean;
}

const NO_NODES: TaxiNode[] = [];

function templatesOf(map: WorldMap): TransportTemplate[] {
  return map.transport?.templates ?? [];
}

/** The view's template, falling back to the map's first. */
export function templateOf(map: WorldMap, view: TransportView): TransportTemplate {
  const templates = templatesOf(map);
  return templates.find((t) => t.entry === view.template) ?? templates[0]!;
}

export function nodesOf(map: WorldMap, view: TransportView): TaxiNode[] {
  return map.transport?.paths[templateOf(map, view).pathId] ?? NO_NODES;
}

/** A saved view made valid: an unknown template becomes the first, an unusable node the default one. */
export function normaliseView(map: WorldMap, saved: Partial<TransportView> | undefined, drawable: (map: number) => boolean): TransportView {
  const template = templateOf(map, { template: saved?.template ?? Number.NaN, node: 0 }).entry;
  const nodes = nodesOf(map, { template, node: 0 });
  const node = saved?.node;
  if (node !== undefined && Number.isInteger(node) && node >= 0 && node < nodes.length && drawable(nodes[node]!.map)) return { template, node };
  return { template, node: Math.max(0, defaultNode(nodes, drawable)) };
}

export function frameOfView(map: WorldMap, view: TransportView): Frame {
  return frameAt(nodesOf(map, view), view.node);
}

export function hostMapIdOf(map: WorldMap, view: TransportView): number {
  return nodesOf(map, view)[view.node]!.map;
}

/** The route's runs on the host map, each with its stops marked; a path of one node is no route, so draws nothing. */
export function routeLinesOf(map: WorldMap, view: TransportView): RouteLine[] {
  const nodes = nodesOf(map, view);
  if (nodes.length < 2) return [];
  const host = hostMapIdOf(map, view);
  return hostRuns(nodes)
    .filter((run) => run.map === host)
    .map((run) => ({
      points: run.nodes.map(({ x, y, z }) => ({ x, y, z })),
      stops: run.nodes.filter((n) => n.flags & NODE_STOP).map(({ index, x, y, z }) => ({ node: index, x, y, z })),
    }));
}

/** Every node of the route, stops first, each group in path order. */
export function nodeOptions(map: WorldMap, view: TransportView, nameOf: (map: number) => string): NodeOption[] {
  let stops = 0;
  const all = nodesOf(map, view).map((n, node) => {
    const stop = (n.flags & NODE_STOP) !== 0;
    const label = stop ? `Stop ${++stops}` : `Point ${node + 1}`;
    return { node, stop, label: `${label} · ${nameOf(n.map)}` };
  });
  return [...all.filter((o) => o.stop), ...all.filter((o) => !o.stop)];
}

export interface RouteStop {
  node: number;
  label: string;
  map: number;
  x: number;
  y: number;
  z: number;
}

/** The stops of a template's route in the order it runs them, those on terrain the World draws, each named by `nameOf` (the place it is at). */
export function stopsOf(map: WorldMap, template: number, nameOf: (at: { map: number; x: number; y: number }) => string, drawable: (map: number) => boolean): RouteStop[] {
  const stops: RouteStop[] = [];
  nodesOf(map, { template, node: 0 }).forEach((n, node) => {
    if (n.flags & NODE_STOP && drawable(n.map)) stops.push({ node, label: nameOf(n), map: n.map, x: n.x, y: n.y, z: n.z });
  });
  return stops;
}
