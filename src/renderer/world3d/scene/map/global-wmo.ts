import type { MapAreaSpec } from './loader/types.js';

/**
 * A map stored as one building (most dungeons) has no terrain tiles: the building stands at the world's
 * origin, and the server's spawns for it are measured from there. It is drawn as a single area holding
 * that building and nothing else, in the tile the origin falls in.
 *
 * The building is turned half a turn about the vertical axis, as a tile's buildings are for a rotation of
 * zero: a spawn's X and Y are the building's own, mirrored (the Stormwind Stockade's file spans X -197 to 8,
 * its spawns 67 to 193; Blackrock Depths' Y -265 to 848, its spawns -832 to 201).
 */

export interface GlobalWmo {
  path: string;
  /** Which of the building's doodad sets its placement shows beside the default one */
  doodadSet: number;
}

/** The tile the origin is in: `areaX` counts north to south, `areaY` west to east */
export const GLOBAL_AREA = { areaX: 32, areaY: 32 };

/** Every place a map's spawns can be: the whole of the server's grid */
export const WHOLE_MAP = { minX: -17100, maxX: 17100, minY: -17100, maxY: 17100 };

/** The area of a one-building map: the building at the origin, no terrain, no water */
export function globalWmoArea(wmo: GlobalWmo): MapAreaSpec {
  return {
    terrain: [],
    liquids: [],
    areaTableIds: new Uint32Array(256),
    doodadDefs: [],
    objDefs: [{ id: 0, name: wmo.path, position: [0, 0, 0], rotation: [0, 0, 1, 0], doodadSet: wmo.doodadSet }],
  };
}
