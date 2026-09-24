/**
 * Ground height from the server's own terrain files (`<DataDir>/maps/*.map`, written by the map
 * extractor). Every rule here mirrors `GridTerrainData` in the fork, so a height read here is the
 * height the server uses: the same grid file, the same cell, the same triangle, the same holes.
 */

export class TerrainFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TerrainFormatError';
  }
}

export interface TerrainFile {
  kind: 'flat' | 'float' | 'uint16' | 'uint8';
  /** The grid's minimum (and, for a flat grid, only) height. */
  gridHeight: number;
  /** What one step of an integer height is worth; unused for floats. */
  multiplier: number;
  /** 129 × 129 corner heights. */
  v9: ArrayLike<number>;
  /** 128 × 128 cell-centre heights. */
  v8: ArrayLike<number>;
  /** 16 × 16 cells of 4 × 4 hole bits, or null when the grid has none. */
  holes: Uint16Array | null;
  /** The grid's water, or null when it has none. */
  liquid: LiquidData | null;
  /** The area ids of the grid's cells, or null when the file has no area section. */
  area: AreaData | null;
}

/** `LoadedAreaData` in the fork: one area for the whole grid, or one per cell of 16 × 16. */
export interface AreaData {
  gridArea: number;
  cells: Uint16Array | null;
}

/** `LoadedLiquidData` in the fork: a level (global or per point) and which 8 × 8-cell blocks have water. */
export interface LiquidData {
  globalFlags: number;
  globalLevel: number;
  offX: number;
  offY: number;
  width: number;
  height: number;
  /** 16 × 16 block flags; null when the file has none and the global flags apply everywhere. */
  flags: Uint8Array | null;
  /** `width × height` levels; null when the file has none and the global level applies. */
  levels: Float32Array | null;
}

/** `SIZE_OF_GRIDS`: yards per grid, 64 grids across a map. */
const SIZE_OF_GRIDS = 533.3333;
/** `MAP_RESOLUTION`: height cells per grid side. */
const MAP_RESOLUTION = 128;
const CENTER_GRID_ID = 32;
const MAP_VERSION = 9;

const HEIGHT_NO_HEIGHT = 0x1;
const HEIGHT_AS_INT16 = 0x2;
const HEIGHT_AS_INT8 = 0x4;
const MAP_AREA_NO_AREA = 0x1;
const LIQUID_NO_TYPE = 0x1;
const LIQUID_NO_HEIGHT = 0x2;

const HOLETAB_H = [0x1111, 0x2222, 0x4444, 0x8888];
const HOLETAB_V = [0x000f, 0x00f0, 0x0f00, 0xf000];

const V9 = 129 * 129;
const V8 = 128 * 128;

const fourcc = (bytes: Uint8Array, at: number): string =>
  String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);

/** The grid file the server loads for a point: `<map:03><gx:02><gy:02>.map`. */
export function gridFileName(map: number, x: number, y: number): string {
  const grid = (c: number): number => Math.max(0, Math.trunc(CENTER_GRID_ID - c / SIZE_OF_GRIDS));
  const pad = (n: number, width: number): string => String(n).padStart(width, '0');
  return `${pad(map, 3)}${pad(grid(x), 2)}${pad(grid(y), 2)}.map`;
}

export function parseMapFile(bytes: Uint8Array): TerrainFile {
  if (bytes.length < 44 || fourcc(bytes, 0) !== 'MAPS') throw new TerrainFormatError('This is not a map file.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(4, true);
  if (version !== MAP_VERSION) throw new TerrainFormatError(`This map file is version ${version}; the server reads version ${MAP_VERSION}.`);
  const areaOffset = view.getUint32(12, true);
  const heightOffset = view.getUint32(20, true);
  const liquidOffset = view.getUint32(28, true);
  const holesOffset = view.getUint32(36, true);
  const holesSize = view.getUint32(40, true);

  let holes: Uint16Array | null = null;
  if (holesSize > 0 && holesOffset > 0) {
    if (holesOffset + 512 > bytes.length) throw new TerrainFormatError('The map file ends before its holes.');
    holes = new Uint16Array(256);
    for (let k = 0; k < 256; k++) holes[k] = view.getUint16(holesOffset + k * 2, true);
  }

  const liquid = liquidOffset > 0 ? parseLiquid(bytes, view, liquidOffset) : null;
  const area = areaOffset > 0 ? parseArea(bytes, view, areaOffset) : null;

  if (heightOffset === 0) return { kind: 'flat', gridHeight: Number.NaN, multiplier: 0, v9: [], v8: [], holes, liquid, area };
  if (fourcc(bytes, heightOffset) !== 'MHGT') throw new TerrainFormatError('The map file has no height section.');
  const flags = view.getUint32(heightOffset + 4, true);
  const gridHeight = view.getFloat32(heightOffset + 8, true);
  const gridMaxHeight = view.getFloat32(heightOffset + 12, true);
  const data = heightOffset + 16;
  if (flags & HEIGHT_NO_HEIGHT) return { kind: 'flat', gridHeight, multiplier: 0, v9: [], v8: [], holes, liquid, area };

  const read = (size: number, count: number, at: number, get: (offset: number) => number): number[] => {
    if (at + size * count > bytes.length) throw new TerrainFormatError('The map file ends inside its height data.');
    return Array.from({ length: count }, (_, i) => get(at + i * size));
  };
  if (flags & HEIGHT_AS_INT16) {
    const v9 = read(2, V9, data, (o) => view.getUint16(o, true));
    const v8 = read(2, V8, data + V9 * 2, (o) => view.getUint16(o, true));
    return { kind: 'uint16', gridHeight, multiplier: (gridMaxHeight - gridHeight) / 65535, v9, v8, holes, liquid, area };
  }
  if (flags & HEIGHT_AS_INT8) {
    const v9 = read(1, V9, data, (o) => view.getUint8(o));
    const v8 = read(1, V8, data + V9, (o) => view.getUint8(o));
    return { kind: 'uint8', gridHeight, multiplier: (gridMaxHeight - gridHeight) / 255, v9, v8, holes, liquid, area };
  }
  const v9 = read(4, V9, data, (o) => view.getFloat32(o, true));
  const v8 = read(4, V8, data + V9 * 4, (o) => view.getFloat32(o, true));
  return { kind: 'float', gridHeight, multiplier: 1, v9, v8, holes, liquid, area };
}

function parseArea(bytes: Uint8Array, view: DataView, at: number): AreaData | null {
  if (at + 8 > bytes.length) throw new TerrainFormatError('The map file ends inside its areas.');
  if (fourcc(bytes, at) !== 'AREA') return null;
  const flags = view.getUint16(at + 4, true);
  const gridArea = view.getUint16(at + 6, true);
  if (flags & MAP_AREA_NO_AREA) return { gridArea, cells: null };
  if (at + 8 + 512 > bytes.length) throw new TerrainFormatError('The map file ends inside its areas.');
  const cells = new Uint16Array(256);
  for (let k = 0; k < 256; k++) cells[k] = view.getUint16(at + 8 + k * 2, true);
  return { gridArea, cells };
}

/** Only the area section of a `.map` file: what the map's painted art needs, without the heights. */
export function parseMapArea(bytes: Uint8Array): AreaData | null {
  if (bytes.length < 44 || fourcc(bytes, 0) !== 'MAPS') throw new TerrainFormatError('This is not a map file.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const areaOffset = view.getUint32(12, true);
  return areaOffset > 0 ? parseArea(bytes, view, areaOffset) : null;
}

/** The area id at a point of this grid, as `GridTerrainData::getArea` reads it; 0 without area data. */
export function areaAt(file: Pick<TerrainFile, 'area'>, x: number, y: number): number {
  if (!file.area) return 0;
  if (!file.area.cells) return file.area.gridArea;
  const lx = Math.trunc(16 * (CENTER_GRID_ID - x / SIZE_OF_GRIDS)) & 15;
  const ly = Math.trunc(16 * (CENTER_GRID_ID - y / SIZE_OF_GRIDS)) & 15;
  return file.area.cells[lx * 16 + ly]!;
}

function parseLiquid(bytes: Uint8Array, view: DataView, at: number): LiquidData | null {
  if (at + 16 > bytes.length) throw new TerrainFormatError('The map file ends before its water.');
  if (fourcc(bytes, at) !== 'MLIQ') return null;
  const headerFlags = view.getUint8(at + 4);
  const liquid: LiquidData = {
    globalFlags: view.getUint8(at + 5),
    offX: view.getUint8(at + 8),
    offY: view.getUint8(at + 9),
    width: view.getUint8(at + 10),
    height: view.getUint8(at + 11),
    globalLevel: view.getFloat32(at + 12, true),
    flags: null,
    levels: null,
  };
  let o = at + 16;
  if (!(headerFlags & LIQUID_NO_TYPE)) {
    if (o + 512 + 256 > bytes.length) throw new TerrainFormatError('The map file ends inside its water.');
    o += 512; // the liquid type of each block, which the map does not need
    liquid.flags = bytes.slice(o, o + 256);
    o += 256;
  }
  if (!(headerFlags & LIQUID_NO_HEIGHT)) {
    const count = liquid.width * liquid.height;
    if (o + count * 4 > bytes.length) throw new TerrainFormatError('The map file ends inside its water levels.');
    liquid.levels = new Float32Array(count);
    for (let k = 0; k < count; k++) liquid.levels[k] = view.getFloat32(o + k * 4, true);
  }
  return liquid;
}

/** The water level at a point of this grid, or null where there is no water; as the server reads it. */
export function liquidLevel(file: TerrainFile, x: number, y: number): number | null {
  const liquid = file.liquid;
  if (!liquid) return null;
  const cx = Math.trunc(MAP_RESOLUTION * (CENTER_GRID_ID - x / SIZE_OF_GRIDS)) & (MAP_RESOLUTION - 1);
  const cy = Math.trunc(MAP_RESOLUTION * (CENTER_GRID_ID - y / SIZE_OF_GRIDS)) & (MAP_RESOLUTION - 1);
  const wet = liquid.flags ? liquid.flags[(cx >> 3) * 16 + (cy >> 3)] !== 0 : liquid.globalFlags !== 0;
  if (!wet) return null;
  if (!liquid.levels) return liquid.globalLevel;
  const i = cx - liquid.offY;
  const j = cy - liquid.offX;
  if (i < 0 || i >= liquid.height || j < 0 || j >= liquid.width) return null;
  return liquid.levels[i * liquid.width + j]!;
}

function isHole(holes: Uint16Array | null, row: number, col: number): boolean {
  if (!holes) return false;
  const cellRow = Math.trunc(row / 8);
  const cellCol = Math.trunc(col / 8);
  const holeRow = Math.trunc((row % 8) / 2);
  const holeCol = Math.trunc((col - cellCol * 8) / 2);
  const hole = holes[cellRow * 16 + cellCol]!;
  return (hole & HOLETAB_H[holeCol]! & HOLETAB_V[holeRow]!) !== 0;
}

/** The ground height at a point of this grid, or null where the terrain has a hole or no height. */
export function terrainHeight(file: TerrainFile, x: number, y: number): number | null {
  let fx = MAP_RESOLUTION * (CENTER_GRID_ID - x / SIZE_OF_GRIDS);
  let fy = MAP_RESOLUTION * (CENTER_GRID_ID - y / SIZE_OF_GRIDS);
  let xi = Math.trunc(fx);
  let yi = Math.trunc(fy);
  fx -= xi;
  fy -= yi;
  xi &= MAP_RESOLUTION - 1;
  yi &= MAP_RESOLUTION - 1;

  if (isHole(file.holes, xi, yi)) return null;
  if (file.kind === 'flat') return Number.isNaN(file.gridHeight) ? null : file.gridHeight;

  const v9 = (i: number, j: number): number => file.v9[i * 129 + j]!;
  const h5 = 2 * file.v8[xi * 128 + yi]!;
  let a: number;
  let b: number;
  let c: number;
  if (fx + fy < 1) {
    if (fx > fy) {
      const h1 = v9(xi, yi);
      const h2 = v9(xi + 1, yi);
      [a, b, c] = [h2 - h1, h5 - h1 - h2, h1];
    } else {
      const h1 = v9(xi, yi);
      const h3 = v9(xi, yi + 1);
      [a, b, c] = [h5 - h1 - h3, h3 - h1, h1];
    }
  } else if (fx > fy) {
    const h2 = v9(xi + 1, yi);
    const h4 = v9(xi + 1, yi + 1);
    [a, b, c] = [h2 + h4 - h5, h4 - h2, h5 - h4];
  } else {
    const h3 = v9(xi, yi + 1);
    const h4 = v9(xi + 1, yi + 1);
    [a, b, c] = [h4 - h3, h3 + h4 - h5, h5 - h4];
  }
  const raw = a * fx + b * fy + c;
  return file.kind === 'float' ? raw : raw * file.multiplier + file.gridHeight;
}
