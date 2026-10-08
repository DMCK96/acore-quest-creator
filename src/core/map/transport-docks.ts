import { NODE_STOP } from '../game/taxi-path';
import { frameAt, type Frame } from './transport-frame';
import type { WorldMap } from './world-maps';

/** One stop of a transport map's route on a continent, where its vessel stands with its passengers */
export interface Dock {
  /** `map:node`, unique among docks */
  key: string;
  /** The transport map */
  map: number;
  /** The entry of the template whose vessel is drawn (the map's first) */
  template: number;
  /** The stop's index in that template's path */
  node: number;
  displayId: number;
  frame: Frame;
}

/**
 * The docks on a continent: each stop of every transport map's first template that lies on it. Only the first
 * template, since the map's passengers would otherwise be drawn once for each. `exclude` is the transport map
 * the transport view shows: its passengers are drawn there already, and a dock of it would draw them again.
 */
export function docksOn(maps: readonly WorldMap[], host: number, exclude?: number): Dock[] {
  const docks: Dock[] = [];
  for (const map of maps) {
    if (map.id === exclude) continue;
    const template = map.transport?.templates[0];
    const path = template && map.transport?.paths[template.pathId];
    if (!template || !path) continue;
    path.forEach((n, node) => {
      if (n.map !== host || !(n.flags & NODE_STOP)) return;
      docks.push({ key: `${map.id}:${node}`, map: map.id, template: template.entry, node, displayId: template.displayId, frame: frameAt(path, node) });
    });
  }
  return docks;
}
