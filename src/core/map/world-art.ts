import { decodeBlp, scaleRgba, type RgbaImage } from '../client/blp';
import { dbcFloat, dbcString, parseDbc } from '../game/dbc';
import { ART_ZOOM, pixel0ToWorld, TILE_PX } from './coords';

/**
 * The client's painted zone maps (the in-game world map) as map tiles. Each zone's art is twelve
 * BLPs covering its box from `WorldMapArea.dbc`; boxes overlap, and each zone paints its
 * neighbours dimmed, so every pixel takes the art of the zone its ground belongs to (the server's
 * area id there, walked up to its zone), and the continent's art where no zone claims it.
 */

export interface ZoneArt {
  id: number;
  map: number;
  /** The zone's area id; 0 for a continent's own map. */
  area: number;
  /** The art folder under `Interface\WorldMap`. */
  name: string;
  /** Box edges in world yards: west and east are Y, north and south are X. */
  west: number;
  east: number;
  north: number;
  south: number;
}

/** The part of the 1024 × 768 art image the zone box covers. */
const ART_FRACTION_X = 1002 / 1024;
const ART_FRACTION_Y = 668 / 768;
const MAX_PARENT_STEPS = 16;

/** `WorldMapAreaEntry`: 0 id, 1 map, 2 area, 3 art name, 4–7 left, right, top, bottom. */
export function parseWorldMapAreas(bytes: Uint8Array): ZoneArt[] {
  return parseDbc(bytes, 'WorldMapArea.dbc').records.map((r) => ({
    id: r[0]!,
    map: r[1]!,
    area: r[2]!,
    name: dbcString(bytes, r[3]!),
    west: dbcFloat(r[4]!),
    east: dbcFloat(r[5]!),
    north: dbcFloat(r[6]!),
    south: dbcFloat(r[7]!),
  }));
}

/** `AreaTableEntry`: each area's parent (0 for a zone). */
export function parseAreaParents(bytes: Uint8Array): Map<number, number> {
  return new Map(parseDbc(bytes, 'AreaTable.dbc').records.map((r) => [r[0]!, r[2]!]));
}

const inBox = (z: ZoneArt, x: number, y: number): boolean => x <= z.north && x >= z.south && y <= z.west && y >= z.east;
const boxArea = (z: ZoneArt): number => (z.west - z.east) * (z.north - z.south);

export function zoneFinder(
  zones: ZoneArt[],
  parents: Map<number, number>,
  map: number,
): { continent: ZoneArt | null; zones: ZoneArt[]; zoneAt(x: number, y: number, area: number | null): ZoneArt | null } {
  const continent = zones.find((z) => z.map === map && z.area === 0) ?? null;
  const own = zones.filter((z) => z.map === map && z.area !== 0);
  const byArea = new Map<number, ZoneArt>();
  for (const z of own) if (!byArea.has(z.area)) byArea.set(z.area, z);
  const bySize = [...own].sort((a, b) => boxArea(a) - boxArea(b));
  return {
    continent,
    zones: own,
    zoneAt(x, y, area) {
      // No terrain file here, so no area: the smallest zone box around the point.
      if (area === null) return bySize.find((z) => inBox(z, x, y)) ?? null;
      let at = area;
      for (let step = 0; at !== 0 && step < MAX_PARENT_STEPS; step++) {
        const zone = byArea.get(at);
        if (zone) return zone;
        at = parents.get(at) ?? 0;
      }
      return null;
    },
  };
}

/** A zone's twelve art tiles as one image, four across and three down; null when it has none. */
export async function loadZoneArt(read: (path: string) => Promise<Uint8Array | null>, name: string): Promise<RgbaImage | null> {
  const tiles = await Promise.all(
    Array.from({ length: 12 }, async (_, i): Promise<RgbaImage | null> => {
      const bytes = await read(`Interface\\WorldMap\\${name}\\${name}${i + 1}.blp`);
      if (!bytes) return null;
      try {
        return decodeBlp(bytes);
      } catch {
        return null;
      }
    }),
  );
  const first = tiles.find((t) => t !== null);
  if (!first) return null;
  const tw = first.width;
  const th = first.height;
  const width = tw * 4;
  const image: RgbaImage = { width, height: th * 3, rgba: new Uint8Array(width * th * 3 * 4) };
  tiles.forEach((tile, i) => {
    if (!tile) return;
    const t = tile.width === tw && tile.height === th ? tile : scaleRgba(tile, tw, th);
    const x0 = (i % 4) * tw;
    const y0 = Math.floor(i / 4) * th;
    for (let row = 0; row < th; row++) image.rgba.set(t.rgba.subarray(row * tw * 4, (row + 1) * tw * 4), ((y0 + row) * width + x0) * 4);
  });
  return image;
}

/** The art at a world point, or null where the point is outside the box or the art is see-through. */
function sample(zone: ZoneArt, image: RgbaImage, x: number, y: number, out: Uint8Array, at: number): boolean {
  if (!inBox(zone, x, y)) return false;
  const { width, height, rgba } = image;
  const u = Math.min(width - 1, Math.max(0, ((zone.west - y) / (zone.west - zone.east)) * width * ART_FRACTION_X - 0.5));
  const v = Math.min(height - 1, Math.max(0, ((zone.north - x) / (zone.north - zone.south)) * height * ART_FRACTION_Y - 0.5));
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = u - x0;
  const fy = v - y0;
  const channel = (k: number): number =>
    (rgba[(y0 * width + x0) * 4 + k]! * (1 - fx) + rgba[(y0 * width + x1) * 4 + k]! * fx) * (1 - fy) +
    (rgba[(y1 * width + x0) * 4 + k]! * (1 - fx) + rgba[(y1 * width + x1) * 4 + k]! * fx) * fy;
  if (channel(3) < 128) return false;
  out[at] = Math.round(channel(0));
  out[at + 1] = Math.round(channel(1));
  out[at + 2] = Math.round(channel(2));
  out[at + 3] = 255;
  return true;
}

/** One map tile at `ART_ZOOM` painted from the art: RGBA, transparent where nothing is painted. */
export function composeArtTile(opts: {
  tx: number;
  ty: number;
  zoneAt(x: number, y: number): ZoneArt | null;
  continent: ZoneArt | null;
  image(zone: ZoneArt): RgbaImage | null;
}): Uint8Array {
  const out = new Uint8Array(TILE_PX * TILE_PX * 4);
  const scale = 2 ** ART_ZOOM;
  // Each zone's image is asked for once per tile, not once per pixel.
  const images = new Map<ZoneArt, RgbaImage | null>();
  const imageOf = (zone: ZoneArt): RgbaImage | null => {
    if (!images.has(zone)) images.set(zone, opts.image(zone));
    return images.get(zone)!;
  };
  const continentImage = opts.continent ? imageOf(opts.continent) : null;
  for (let row = 0; row < TILE_PX; row++) {
    for (let col = 0; col < TILE_PX; col++) {
      const { x, y } = pixel0ToWorld((opts.tx * TILE_PX + col + 0.5) / scale, (opts.ty * TILE_PX + row + 0.5) / scale);
      const at = (row * TILE_PX + col) * 4;
      const zone = opts.zoneAt(x, y);
      const zoneImage = zone ? imageOf(zone) : null;
      if (zone && zoneImage && sample(zone, zoneImage, x, y, out, at)) continue;
      if (opts.continent && continentImage) sample(opts.continent, continentImage, x, y, out, at);
    }
  }
  return out;
}
