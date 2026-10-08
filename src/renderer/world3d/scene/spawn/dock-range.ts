import { Map } from '@wowserhq/format';
import { nearbyAreas } from './placement.js';

/** Whether a dock stands in the tile the camera is over or one next to it: the area spawns are loaded for */
export function dockInRange(at: { x: number; y: number }, target: { areaX: number; areaY: number }): boolean {
  try {
    const { areaX, areaY } = Map.getIndicesFromPosition(at.x, at.y);
    return nearbyAreas(target.areaX, target.areaY).has(`${areaX}:${areaY}`);
  } catch {
    // Off the world's grid
    return false;
  }
}
