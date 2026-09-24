import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { parseMapFile, type TerrainFile } from '../core/game/terrain';
import { MAX_ZOOM, MIN_ZOOM, TILE_PX, tileGrids } from '../core/map/coords';
import { decodeOwnPng, encodePng } from '../core/map/png';
import { downsample, emptyPixels, reliefPixels } from '../core/map/relief';
import type { ServerDataFiles } from './server-data';

/**
 * Relief tiles for the quest map, served to the page as `acqc-map://tile/<map>/<zoom>/<tx>/<ty>.png`.
 * A zoom-6 tile is one grid of the server data folder's terrain; each zoom out is four tiles shrunk
 * into one. Finished tiles are cached on disk per data folder, so a map is drawn once. Nothing here
 * throws to the page: anything missing or unreadable is a transparent tile.
 */

export interface MapTiles {
  setDataDir(dir: string | null): void;
  tile(map: number, zoom: number, tx: number, ty: number): Promise<Uint8Array>;
}

export interface TileCache {
  read(path: string): Promise<Uint8Array | null>;
  write(path: string, bytes: Uint8Array): Promise<void>;
}

/** A tile as sent (its PNG) and as its parent needs it (pixels; null when it has no terrain). */
interface Drawn {
  png: Uint8Array;
  pixels: Uint8Array | null;
}

const TILE_URL = /^acqc-map:\/\/tile\/(\d+)\/(\d+)\/(\d+)\/(\d+)\.png$/;
/** Part of every cached tile's path: raise it when tiles are drawn differently, so old ones are redrawn. */
const RELIEF_VERSION = 'r2';
/** Rendered pixel buffers kept while zoomed-out tiles are built from their children. */
const RGBA_CACHE_SIZE = 256;

export function parseTileUrl(url: string): { map: number; zoom: number; tx: number; ty: number } | null {
  const match = TILE_URL.exec(url);
  if (!match) return null;
  const [map, zoom, tx, ty] = match.slice(1).map(Number) as [number, number, number, number];
  if (zoom < MIN_ZOOM || zoom > MAX_ZOOM || tx >= 2 ** zoom || ty >= 2 ** zoom) return null;
  return { map, zoom, tx, ty };
}

export function createMapTiles(deps: { files: ServerDataFiles; cache: TileCache; cacheRoot: string }): MapTiles {
  let dir: string | null = null;
  let folderKey = '';
  const transparent = encodePng(TILE_PX, TILE_PX, emptyPixels());
  const rgbaCache = new Map<string, Drawn>();
  const reported = new Set<string>();

  const remember = (key: string, value: Drawn): void => {
    rgbaCache.set(key, value);
    if (rgbaCache.size > RGBA_CACHE_SIZE) rgbaCache.delete(rgbaCache.keys().next().value!);
  };

  async function grid(map: number, gx: number, gy: number): Promise<TerrainFile | null> {
    if (!dir) return null;
    const pad = (n: number, width: number): string => String(n).padStart(width, '0');
    const name = `${pad(map, 3)}${pad(gx, 2)}${pad(gy, 2)}.map`;
    // The folder may be the server's DataDir or its dbc folder; maps/ sits in the one, beside the other.
    for (const folder of [join(dir, 'maps'), join(dir, '..', 'maps')]) {
      const bytes = await deps.files.read(folder, name);
      if (!bytes) continue;
      try {
        return parseMapFile(bytes);
      } catch (error) {
        if (!reported.has(name)) {
          reported.add(name);
          console.warn(`Map tile: ${name} could not be read: ${error instanceof Error ? error.message : String(error)}`);
        }
        return null;
      }
    }
    return null;
  }

  const pathOf = (map: number, zoom: number, tx: number, ty: number): string =>
    // Joined with '/', which every platform accepts, so cache paths look the same everywhere.
    `${deps.cacheRoot}/${folderKey}/${RELIEF_VERSION}/${map}/${zoom}/${tx}/${ty}.png`;
  const inFlight = new Map<string, Promise<Drawn>>();

  /**
   * A tile drawn, as its PNG and its pixels (null when nothing in it has terrain): from memory, from
   * the disk cache, or drawn now and written there. Zoomed-out tiles are drawn from their four
   * children the same way, so a grid is read once however far the author zooms out, and a tile
   * asked for twice at once is drawn once.
   */
  function drawn(map: number, zoom: number, tx: number, ty: number): Promise<Drawn> {
    const key = `${folderKey}/${map}/${zoom}/${tx}/${ty}`;
    const remembered = rgbaCache.get(key);
    if (remembered !== undefined) return Promise.resolve(remembered);
    const pending = inFlight.get(key);
    if (pending) return pending;
    const work = (async (): Promise<Drawn> => {
      const path = pathOf(map, zoom, tx, ty);
      const cached = await deps.cache.read(path);
      const decoded = cached ? decodeOwnPng(cached) : null;
      if (cached && decoded) return { png: cached, pixels: decoded.rgba.some((v, i) => i % 4 === 3 && v !== 0) ? decoded.rgba : null };
      let pixels: Uint8Array | null;
      if (zoom === MAX_ZOOM) {
        const { gx0, gy0 } = tileGrids(zoom, tx, ty);
        const file = await grid(map, gx0, gy0);
        pixels = file ? reliefPixels(file, gx0, gy0) : null;
      } else {
        const children = await Promise.all([
          drawn(map, zoom + 1, tx * 2, ty * 2),
          drawn(map, zoom + 1, tx * 2 + 1, ty * 2),
          drawn(map, zoom + 1, tx * 2, ty * 2 + 1),
          drawn(map, zoom + 1, tx * 2 + 1, ty * 2 + 1),
        ]);
        const quarters = children.map((c) => c.pixels) as [Uint8Array | null, Uint8Array | null, Uint8Array | null, Uint8Array | null];
        pixels = quarters.some((c) => c !== null) ? downsample(quarters) : null;
      }
      const png = pixels ? encodePng(TILE_PX, TILE_PX, pixels) : transparent;
      await deps.cache.write(path, png);
      return { png, pixels };
    })();
    inFlight.set(key, work);
    return work.then(
      (result) => {
        inFlight.delete(key);
        remember(key, result);
        return result;
      },
      (error: unknown) => {
        inFlight.delete(key);
        throw error;
      },
    );
  }

  return {
    setDataDir(next) {
      dir = next && next.trim() !== '' ? next : null;
      folderKey = dir ? createHash('sha1').update(dir).digest('hex').slice(0, 12) : '';
      rgbaCache.clear();
    },
    async tile(map, zoom, tx, ty) {
      if (!dir) return transparent;
      try {
        return (await drawn(map, zoom, tx, ty)).png;
      } catch (error) {
        console.warn(`Map tile ${map}/${zoom}/${tx}/${ty} failed: ${error instanceof Error ? error.message : String(error)}`);
        return transparent;
      }
    },
  };
}
