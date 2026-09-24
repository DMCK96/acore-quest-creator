import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { parseMapFile, type TerrainFile } from '../core/game/terrain';
import { MAX_ZOOM, MIN_ZOOM, TILE_PX, tileGrids } from '../core/map/coords';
import { encodePng } from '../core/map/png';
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
  const rgbaCache = new Map<string, Uint8Array | null>();
  const reported = new Set<string>();

  const remember = (key: string, value: Uint8Array | null): void => {
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

  /** A tile's pixels, or null when nothing in it has terrain. */
  async function rgba(map: number, zoom: number, tx: number, ty: number): Promise<Uint8Array | null> {
    const key = `${folderKey}/${map}/${zoom}/${tx}/${ty}`;
    if (rgbaCache.has(key)) return rgbaCache.get(key)!;
    let pixels: Uint8Array | null;
    if (zoom === MAX_ZOOM) {
      const { gx0, gy0 } = tileGrids(zoom, tx, ty);
      const file = await grid(map, gx0, gy0);
      pixels = file ? reliefPixels(file, gx0, gy0) : null;
    } else {
      const children = await Promise.all([
        rgba(map, zoom + 1, tx * 2, ty * 2),
        rgba(map, zoom + 1, tx * 2 + 1, ty * 2),
        rgba(map, zoom + 1, tx * 2, ty * 2 + 1),
        rgba(map, zoom + 1, tx * 2 + 1, ty * 2 + 1),
      ] as const);
      pixels = children.some((c) => c !== null) ? downsample(children) : null;
    }
    remember(key, pixels);
    return pixels;
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
        // Joined with '/', which every platform accepts, so cache paths look the same everywhere.
        const path = `${deps.cacheRoot}/${folderKey}/${RELIEF_VERSION}/${map}/${zoom}/${tx}/${ty}.png`;
        const cached = await deps.cache.read(path);
        if (cached) return cached;
        const pixels = await rgba(map, zoom, tx, ty);
        const png = pixels ? encodePng(TILE_PX, TILE_PX, pixels) : transparent;
        await deps.cache.write(path, png);
        return png;
      } catch (error) {
        console.warn(`Map tile ${map}/${zoom}/${tx}/${ty} failed: ${error instanceof Error ? error.message : String(error)}`);
        return transparent;
      }
    },
  };
}
