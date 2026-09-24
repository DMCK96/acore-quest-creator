import { open, readdir, readFile } from 'node:fs/promises';
import { decodeBlp, scaleRgba, type RgbaImage } from '../core/client/blp';
import { openClient, type ClientFs } from '../core/client/client-files';
import { parseMapDirectories } from '../core/game/maps-dbc';
import { ART_ZOOM, gridBounds, GRID_SIZE, TILE_PX, tileGrids } from '../core/map/coords';
import { minimapPath, parseMd5Translate } from '../core/map/minimap';
import { composeArtTile, loadZoneArt, parseAreaParents, parseWorldMapAreas, parseWorldMapOverlays, zoneFinder, type ZoneArt } from '../core/map/world-art';

/**
 * The game client's map pictures as 256 px tiles for the tile service: a grid's minimap texture,
 * and a zoom-5 tile of the painted zone art. Built once per client folder; the archives stay open
 * until `close`. Anything missing gives null, and the tile service draws the relief there instead.
 */

/** The area id at a world point; null where no terrain file covers it. */
export type AreaLookup = (x: number, y: number) => number | null;

export interface MapImagery {
  minimap(map: number, gx: number, gy: number): Promise<Uint8Array | null>;
  art(map: number, tx: number, ty: number, areaAt: AreaLookup): Promise<Uint8Array | null>;
  close(): Promise<void>;
  /** The archives read, lowest priority first. */
  archives: string[];
  /** Changes whenever the client's archives do, so pictures drawn from the old ones are not reused. */
  fingerprint: string;
  /** What could not be read while opening: archives, and the tables the map needs. */
  problems: string[];
}

/** Zone art images kept decoded: about the zones around the view. */
const ART_CACHE_SIZE = 16;

export const nodeClientFs: ClientFs = {
  async list(dir) {
    try {
      return (await readdir(dir, { withFileTypes: true })).map((e) => ({ name: e.name, isDir: e.isDirectory() }));
    } catch {
      return [];
    }
  },
  async open(path) {
    const handle = await open(path, 'r');
    const { size, mtimeMs } = await handle.stat();
    return {
      size,
      modified: Math.round(mtimeMs),
      async read(offset, length) {
        const buffer = new Uint8Array(Math.max(0, Math.min(length, size - offset)));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
        return buffer.subarray(0, bytesRead);
      },
      close: () => handle.close(),
    };
  },
  async readText(path) {
    try {
      return await readFile(path, 'latin1');
    } catch {
      return null;
    }
  },
};

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export async function createClientImagery(dir: string, fs: ClientFs, log: (message: string) => void = () => {}): Promise<MapImagery | null> {
  // Problems met while opening are kept for the status; later ones only go to the log.
  let problems: string[] | null = [];
  const report = (text: string): void => {
    problems?.push(text);
    log(text);
  };
  const files = await openClient(dir, fs, report);
  if (!files) return null;
  const reported = new Set<string>();
  const once = (key: string, text: string): void => {
    if (reported.has(key)) return;
    reported.add(key);
    report(text);
  };
  const parse = async <T>(path: string, how: (bytes: Uint8Array) => T): Promise<T | null> => {
    const bytes = await files.read(path);
    if (!bytes) {
      once(path, `${path} could not be read from the client.`);
      return null;
    }
    try {
      return how(bytes);
    } catch (error) {
      once(path, `${path} could not be read from the client: ${message(error)}`);
      return null;
    }
  };
  const [mapDirs, zones, overlays, parents, translate] = await Promise.all([
    parse('DBFilesClient\\Map.dbc', parseMapDirectories),
    parse('DBFilesClient\\WorldMapArea.dbc', parseWorldMapAreas),
    parse('DBFilesClient\\WorldMapOverlay.dbc', parseWorldMapOverlays),
    parse('DBFilesClient\\AreaTable.dbc', parseAreaParents),
    parse('Textures\\Minimap\\md5translate.trs', (b) => parseMd5Translate(new TextDecoder('latin1').decode(b))),
  ]);

  const opening = problems;
  problems = null;

  const finders = new Map<number, ReturnType<typeof zoneFinder>>();
  const finderFor = (map: number): ReturnType<typeof zoneFinder> => {
    let finder = finders.get(map);
    if (!finder) {
      finder = zoneFinder(zones ?? [], parents ?? new Map(), map);
      finders.set(map, finder);
    }
    return finder;
  };
  const artCache = new Map<string, Promise<RgbaImage | null>>();
  const artOf = (zone: ZoneArt): Promise<RgbaImage | null> => {
    const key = zone.name.toLowerCase();
    let image = artCache.get(key);
    if (image) {
      artCache.delete(key);
    } else {
      image = loadZoneArt((path) => files.read(path), zone.name, overlays?.get(zone.id) ?? []);
    }
    artCache.set(key, image);
    if (artCache.size > ART_CACHE_SIZE) artCache.delete(artCache.keys().next().value!);
    return image;
  };

  return {
    async minimap(map, gx, gy) {
      const mapDir = mapDirs?.get(map);
      if (!mapDir || !translate) return null;
      const path = minimapPath(translate, mapDir, gx, gy);
      if (!path) return null;
      const bytes = await files.read(path);
      if (!bytes) return null;
      try {
        const image = decodeBlp(bytes);
        return image.width === TILE_PX && image.height === TILE_PX ? image.rgba : scaleRgba(image, TILE_PX, TILE_PX).rgba;
      } catch (error) {
        once(path, `${path} could not be decoded: ${message(error)}`);
        return null;
      }
    },
    async art(map, tx, ty, areaAt) {
      if (!zones) return null;
      const finder = finderFor(map);
      const { gx0, gy0, span } = tileGrids(ART_ZOOM, tx, ty);
      const { north, west } = gridBounds(gx0, gy0);
      const south = north - span * GRID_SIZE;
      const east = west - span * GRID_SIZE;
      const overlaps = (z: ZoneArt): boolean => z.south <= north && z.north >= south && z.east <= west && z.west >= east;
      // The continent's own art is left out: it is a whole continent in 1002 px, a blur this close.
      const candidates = finder.zones.filter(overlaps);
      if (candidates.length === 0) return null;
      const loaded = new Map<ZoneArt, RgbaImage | null>();
      await Promise.all(candidates.map(async (z) => loaded.set(z, await artOf(z))));
      return composeArtTile({
        tx,
        ty,
        continent: null,
        image: (z) => loaded.get(z) ?? null,
        // Ground takes its own zone's art; the sea, and ground no zone claims, the smallest zone box around it.
        zoneAt: (x, y) => finder.zoneAt(x, y, areaAt(x, y)) ?? finder.zoneAt(x, y, null),
      });
    },
    close: () => files.close(),
    archives: files.archives,
    fingerprint: files.fingerprint,
    problems: opening,
  };
}
