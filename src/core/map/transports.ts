import { dbcString, parseDbc } from '../game/dbc';
import { MAP_FILE } from '../game/maps-dbc';
import type { TaxiNode } from '../game/taxi-path';
import { defaultNode } from './transport-frame';
import { WORLD_MAPS, type WorldMap } from './world-maps';

export interface TransportTemplate {
  entry: number;
  name: string;
  displayId: number;
  pathId: number;
}

/** Plain data, safe to send over IPC */
export interface TransportInfo {
  templates: TransportTemplate[];
  paths: Record<number, TaxiNode[]>;
}

export interface TransportRow extends TransportTemplate {
  map: number;
}

const continentIds = new Set(WORLD_MAPS.map((m) => m.id));

/**
 * One map per transport map (ships, zeppelins and lifts each have their own map id), listing the templates
 * that live on it. A template is left out when it has no route or none of its nodes lie on a map the view
 * can draw. The map starts at the first template's first stop on terrain, and takes that terrain's folder.
 */
export function buildTransportMaps(input: {
  rows: TransportRow[];
  paths: Map<number, TaxiNode[]>;
  mapDbc: Uint8Array | null;
  hostOf: (map: number) => WorldMap | null;
}): WorldMap[] {
  const { rows, paths, mapDbc, hostOf } = input;
  const drawable = (map: number): boolean => hostOf(map) !== null;
  const dbcNames = new Map<number, string>();
  if (mapDbc) for (const r of parseDbc(mapDbc, MAP_FILE).records) dbcNames.set(r[0]!, dbcString(mapDbc, r[5]!));

  const groups = new Map<number, { template: TransportTemplate; nodes: TaxiNode[] }[]>();
  for (const { map, ...template } of rows) {
    if (map === 0 || continentIds.has(map)) continue;
    const nodes = paths.get(template.pathId);
    if (!nodes || defaultNode(nodes, drawable) < 0) continue;
    groups.set(map, [...(groups.get(map) ?? []), { template, nodes }]);
  }

  const maps: WorldMap[] = [];
  for (const [id, members] of groups) {
    const first = members[0]!;
    const at = first.nodes[defaultNode(first.nodes, drawable)]!;
    maps.push({
      id,
      name: dbcNames.get(id) || first.template.name,
      directory: hostOf(at.map)!.directory,
      kind: 'transport',
      start: { x: at.x, y: at.y, z: at.z },
      transport: {
        templates: members.map((m) => m.template),
        paths: Object.fromEntries(members.map((m) => [m.template.pathId, m.nodes])),
      },
    });
  }
  return maps.sort((a, b) => a.name.localeCompare(b.name));
}
