// @ts-nocheck
/**
 * A building group's water, magma or slime (MLIQ) as a liquid spec, in the building's own space, to
 * be drawn with the same materials as the terrain's liquid.
 *
 * How its liquid type is found (the root's flag 0x4 naming a LiquidType.dbc row, else the tiles'
 * legacy types, else the group's own value) and that a tile's low 4 bits of 0x0F mean "no liquid"
 * follow Adrinalin4ik/world-of-warcraft's `pipeline/wmo/group/loader/definition.js` and
 * `pipeline/liquid/wmo-layer.js` (MIT, see ../../map/liquid/LICENSE and CREDITS.md at the repository
 * root), which follow https://wowdev.wiki/WMO#MOGP_chunk.
 */
import { WmoGroupLiquid } from '../format/group.js';
import { LIQUID_UNIT, LIQUID_VERTEX_STRIDE, LiquidSpec, UV_PER_UNIT } from '../../map/loader/liquid.js';

/** MOHD: the groups' liquid field names a LiquidType.dbc row */
const ROOT_FLAG_LIQUID_TYPE_DBC_ID = 0x4;
/** MOGP: this group's plain water is ocean */
const GROUP_FLAG_OCEAN = 0x80000;
/** LiquidType.dbc rows below this are the basic kinds (water, ocean, magma, slime, in flow speeds) */
const FIRST_NONBASIC_LIQUID_TYPE = 21;
const END_BASIC_LIQUIDS = 20;
const NO_LIQUID = 0x0f;

/**
 * Building liquids carry no depth. Drawn half way between the light database's shallow alpha and
 * solid: canals and fountains read as water you can just see into
 */
const BUILDING_DEPTH = 0.5;

/** A basic kind (water, ocean, magma, slime) as the building row of LiquidType.dbc */
const toBuildingLiquid = (basic: number, groupFlags: number) => {
  switch (basic & 3) {
    case 0:
      return groupFlags & GROUP_FLAG_OCEAN ? 14 : 13; // WMO Ocean : WMO Water
    case 1:
      return 14; // WMO Ocean
    case 2:
      return 19; // WMO Magma
    default:
      return 20; // WMO Slime
  }
};

/** The most common legacy type among the tiles that have liquid (LiquidType.dbc rows run one ahead) */
const legacyTileType = (tiles: Uint8Array) => {
  const counts = new globalThis.Map<number, number>();
  for (const tile of tiles) {
    const type = tile & 0x0f;
    if (type !== NO_LIQUID) {
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
  }

  let dominant = null;
  let most = -1;
  for (const [type, count] of counts) {
    if (count > most) {
      dominant = type;
      most = count;
    }
  }
  return dominant === null ? null : dominant + 1;
};

/** The LiquidType.dbc row a group's liquid is drawn as */
const resolveLiquidType = (liquid: WmoGroupLiquid, rootFlags: number) => {
  const { groupLiquid, groupFlags } = liquid;

  if (rootFlags & ROOT_FLAG_LIQUID_TYPE_DBC_ID) {
    return groupLiquid < FIRST_NONBASIC_LIQUID_TYPE ? toBuildingLiquid(groupLiquid - 1, groupFlags) : groupLiquid;
  }

  const fromTiles = legacyTileType(liquid.tiles);
  if (fromTiles !== null) {
    return fromTiles;
  }

  return groupLiquid < END_BASIC_LIQUIDS ? toBuildingLiquid(groupLiquid, groupFlags) : groupLiquid + 1;
};

/**
 * A group's liquid as a mesh spec: rows along +Y and columns along +X from the corner (a building's
 * grid is not mirrored as the terrain's is), two triangles per tile that has liquid. Null when no
 * tile has any.
 */
const createBuildingLiquidSpec = (liquid: WmoGroupLiquid, rootFlags: number): LiquidSpec | null => {
  const { vertsX, vertsY, tilesX, tilesY, corner, heights, tiles } = liquid;

  let filled = 0;
  for (let y = 0; y < tilesY; y++) {
    for (let x = 0; x < tilesX; x++) {
      if ((tiles[y * tilesX + x] & 0x0f) !== NO_LIQUID && x + 1 < vertsX && y + 1 < vertsY) {
        filled++;
      }
    }
  }
  if (filled === 0) {
    return null;
  }

  const vertexCount = vertsX * vertsY;
  const vertices = new Float32Array(vertexCount * LIQUID_VERTEX_STRIDE);
  const extent = new Float32Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);

  for (let y = 0; y < vertsY; y++) {
    for (let x = 0; x < vertsX; x++) {
      const i = y * vertsX + x;
      const o = i * LIQUID_VERTEX_STRIDE;
      const vx = corner[0] + x * LIQUID_UNIT;
      const vy = corner[1] + y * LIQUID_UNIT;
      const vz = heights[i];

      vertices[o] = vx;
      vertices[o + 1] = vy;
      vertices[o + 2] = vz;
      vertices[o + 3] = vx * UV_PER_UNIT;
      vertices[o + 4] = vy * UV_PER_UNIT;
      vertices[o + 5] = BUILDING_DEPTH;
    }
  }

  const indices = vertexCount > 0xffff ? new Uint32Array(filled * 6) : new Uint16Array(filled * 6);
  let at = 0;
  for (let y = 0; y < tilesY; y++) {
    for (let x = 0; x < tilesX; x++) {
      if ((tiles[y * tilesX + x] & 0x0f) === NO_LIQUID || x + 1 >= vertsX || y + 1 >= vertsY) {
        continue;
      }
      const i = y * vertsX + x;
      indices[at++] = i;
      indices[at++] = i + 1;
      indices[at++] = i + vertsX;
      indices[at++] = i + 1;
      indices[at++] = i + vertsX + 1;
      indices[at++] = i + vertsX;

      // Bounds from the tiles drawn only: vertices next to empty tiles can hold a stray height of 0
      for (const v of [i, i + 1, i + vertsX, i + vertsX + 1]) {
        const o = v * LIQUID_VERTEX_STRIDE;
        for (let axis = 0; axis < 3; axis++) {
          extent[axis] = Math.min(extent[axis], vertices[o + axis]);
          extent[axis + 3] = Math.max(extent[axis + 3], vertices[o + axis]);
        }
      }
    }
  }

  return {
    liquidType: resolveLiquidType(liquid, rootFlags),
    position: [0, 0, 0],
    vertexBuffer: vertices.buffer,
    indexBuffer: indices.buffer,
    wideIndices: indices instanceof Uint32Array,
    bounds: { extent },
  };
};

export { createBuildingLiquidSpec, resolveLiquidType };
