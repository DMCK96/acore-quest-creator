import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { areaAt, parseMapArea, parseMapFile, type AreaData, type TerrainFile } from '../core/game/terrain';
import { ART_ZOOM, gridOf, MAX_ZOOM, MIN_ZOOM, TILE_PX, tileGrids } from '../core/map/coords';
import { decodeOwnPng, encodePng } from '../core/map/png';
import { downsample, emptyPixels, reliefPixels } from '../core/map/relief';
import type { AreaLookup, MapImagery } from './client-imagery';
import type { ServerDataFiles } from './server-data';

/**
 * Map tiles for the quest map, served to the page as `acqc-map://tile/<map>/<zoom>/<tx>/<ty>.png`.
 *
 * The relief: a zoom-6 tile is one grid of the server data folder's terrain, and each zoom out is
 * four tiles shrunk into one. With a game client folder, the picture comes from the client instead:
 * its minimap texture at zoom 6, its painted zone art at zoom 5 (shrunk for 2–4), with the relief
 * wherever the client has nothing. Finished tiles are cached on disk per folder, so a map is drawn
 * once. Nothing here throws to the page: anything missing or unreadable is a transparent tile.
 */

export interface MapTiles {
  setDataDir(dir: string | null): void;
  setClientDir(dir: string | null): void;
  tile(map: number, zoom: number, tx: number, ty: number): Promise<Uint8Array>;
}

export interface TileCache {
  read(path: string): Promise<Uint8Array | null>;
  write(path: string, bytes: Uint8Array): Promise<void>;
}

/** A tile as sent (its PNG) and as its parent needs it (pixels; null when nothing in it is drawn). */
interface Drawn {
  png: Uint8Array;
  pixels: Uint8Array | null;
}

const TILE_URL = /^acqc-map:\/\/tile\/(\d+)\/(\d+)\/(\d+)\/(\d+)\.png$/;
/** Part of every cached tile's path: raise it when tiles are drawn differently, so old ones are redrawn. */
const RELIEF_VERSION = 'r2';
const PICTURE_VERSION = 'r3';
/** Rendered pixel buffers kept while zoomed-out tiles are built from their children. */
const RGBA_CACHE_SIZE = 256;
/** Parsed terrain grids kept: the relief and the area lookups share them. */
const GRID_CACHE_SIZE = 64;
/** Art at least this opaque covers the relief. */
const ART_ALPHA = 128;

export function parseTileUrl(url: string): { map: number; zoom: number; tx: number; ty: number } | null {
  const match = TILE_URL.exec(url);
  if (!match) return null;
  const [map, zoom, tx, ty] = match.slice(1).map(Number) as [number, number, number, number];
  if (zoom < MIN_ZOOM || zoom > MAX_ZOOM || tx >= 2 ** zoom || ty >= 2 ** zoom) return null;
  return { map, zoom, tx, ty };
}

const keyOf = (dir: string | null): string => (dir ? createHash('sha1').update(dir).digest('hex').slice(0, 12) : '');
const hasPixels = (rgba: Uint8Array): boolean => rgba.some((v, i) => i % 4 === 3 && v !== 0);

export function createMapTiles(deps: {
  files: ServerDataFiles;
  cache: TileCache;
  cacheRoot: string;
  openImagery?: (clientDir: string) => Promise<MapImagery | null>;
}): MapTiles {
  let dir: string | null = null;
  let folderKey = '';
  let clientDir: string | null = null;
  let clientKey = '';
  let imagery: Promise<MapImagery | null> | null = null;
  /** Raised whenever a folder changes: a tile drawn across a change is served but never cached. */
  let generation = 0;
  const transparent = encodePng(TILE_PX, TILE_PX, emptyPixels());
  const rgbaCache = new Map<string, Drawn>();
  const gridCache = new Map<string, Promise<TerrainFile | null>>();
  const areaCache = new Map<string, Promise<{ area: AreaData | null } | null>>();
  const inFlight = new Map<string, Promise<Drawn>>();
  const reported = new Set<string>();
  const warnOnce = (key: string, text: string): void => {
    if (reported.has(key)) return;
    reported.add(key);
    console.warn(text);
  };

  const remember = (key: string, value: Drawn): void => {
    rgbaCache.set(key, value);
    if (rgbaCache.size > RGBA_CACHE_SIZE) rgbaCache.delete(rgbaCache.keys().next().value!);
  };

  /** A grid file parsed one way or another; null when it is missing or unreadable. */
  async function readGrid<T>(map: number, gx: number, gy: number, parse: (bytes: Uint8Array) => T): Promise<T | null> {
    if (!dir) return null;
    const pad = (n: number, width: number): string => String(n).padStart(width, '0');
    const name = `${pad(map, 3)}${pad(gx, 2)}${pad(gy, 2)}.map`;
    // The folder may be the server's DataDir or its dbc folder; maps/ sits in the one, beside the other.
    for (const folder of [join(dir, 'maps'), join(dir, '..', 'maps')]) {
      const bytes = await deps.files.read(folder, name);
      if (!bytes) continue;
      try {
        return parse(bytes);
      } catch (error) {
        warnOnce(name, `Map tile: ${name} could not be read: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      }
    }
    return null;
  }

  function lru<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
    let value = cache.get(key);
    if (value) cache.delete(key);
    else value = load();
    cache.set(key, value);
    if (cache.size > GRID_CACHE_SIZE) cache.delete(cache.keys().next().value!);
    return value;
  }

  const grid = (map: number, gx: number, gy: number): Promise<TerrainFile | null> =>
    lru(gridCache, `${folderKey}/${map}/${gx}/${gy}`, () => readGrid(map, gx, gy, parseMapFile));
  /** Only a grid's areas: the painted art needs them, and they are far quicker to read than the heights. */
  const areas = (map: number, gx: number, gy: number): Promise<{ area: AreaData | null } | null> =>
    lru(areaCache, `${folderKey}/${map}/${gx}/${gy}`, () => readGrid(map, gx, gy, (bytes) => ({ area: parseMapArea(bytes) })));

  /**
   * A tile from memory, from the disk cache, or drawn now and written there. A tile asked for twice
   * at once is drawn once.
   */
  function cached(key: string, path: string, draw: () => Promise<Uint8Array | null>): Promise<Drawn> {
    const remembered = rgbaCache.get(key);
    if (remembered !== undefined) return Promise.resolve(remembered);
    const pending = inFlight.get(key);
    if (pending) return pending;
    const started = generation;
    const work = (async (): Promise<Drawn> => {
      const stored = await deps.cache.read(path);
      const decoded = stored ? decodeOwnPng(stored) : null;
      if (stored && decoded) return { png: stored, pixels: hasPixels(decoded.rgba) ? decoded.rgba : null };
      const drawnPixels = await draw();
      const pixels = drawnPixels && hasPixels(drawnPixels) ? drawnPixels : null;
      const png = pixels ? encodePng(TILE_PX, TILE_PX, pixels) : transparent;
      // Drawn partly from folders that have since changed (or archives since closed): not kept.
      if (started === generation) await deps.cache.write(path, png);
      return { png, pixels };
    })();
    inFlight.set(key, work);
    return work.then(
      (result) => {
        inFlight.delete(key);
        if (started === generation) remember(key, result);
        return result;
      },
      (error: unknown) => {
        inFlight.delete(key);
        throw error;
      },
    );
  }

  async function shrink(children: Promise<Drawn>[]): Promise<Uint8Array | null> {
    const quarters = (await Promise.all(children)).map((c) => c.pixels) as [Uint8Array | null, Uint8Array | null, Uint8Array | null, Uint8Array | null];
    return quarters.some((c) => c !== null) ? downsample(quarters) : null;
  }

  const four = <T>(zoom: number, tx: number, ty: number, of: (zoom: number, tx: number, ty: number) => T): T[] => [
    of(zoom + 1, tx * 2, ty * 2),
    of(zoom + 1, tx * 2 + 1, ty * 2),
    of(zoom + 1, tx * 2, ty * 2 + 1),
    of(zoom + 1, tx * 2 + 1, ty * 2 + 1),
  ];

  /** The terrain relief, keyed by the data folder only. */
  function relief(map: number, zoom: number, tx: number, ty: number): Promise<Drawn> {
    // Joined with '/', which every platform accepts, so cache paths look the same everywhere.
    const path = `${deps.cacheRoot}/${folderKey}/${RELIEF_VERSION}/${map}/${zoom}/${tx}/${ty}.png`;
    return cached(`relief/${folderKey}/${map}/${zoom}/${tx}/${ty}`, path, async () => {
      if (zoom === MAX_ZOOM) {
        const { gx0, gy0 } = tileGrids(zoom, tx, ty);
        const file = await grid(map, gx0, gy0);
        return file ? reliefPixels(file, gx0, gy0) : null;
      }
      return shrink(four(zoom, tx, ty, (z, x, y) => relief(map, z, x, y)));
    });
  }

  /** The client's picture over the relief, keyed by both folders. */
  function picture(client: MapImagery, map: number, zoom: number, tx: number, ty: number): Promise<Drawn> {
    const both = `${folderKey}+${clientKey}`;
    const path = `${deps.cacheRoot}/${both}/${PICTURE_VERSION}/${map}/${zoom}/${tx}/${ty}.png`;
    return cached(`picture/${both}/${map}/${zoom}/${tx}/${ty}`, path, async () => {
      if (zoom === MAX_ZOOM) {
        const { gx0, gy0 } = tileGrids(zoom, tx, ty);
        return (await client.minimap(map, gx0, gy0)) ?? (await relief(map, zoom, tx, ty)).pixels;
      }
      if (zoom === ART_ZOOM) {
        const { gx0, gy0, span } = tileGrids(zoom, tx, ty);
        const grids: ({ area: AreaData | null } | null)[] = [];
        for (let gx = gx0; gx < gx0 + span; gx++) for (let gy = gy0; gy < gy0 + span; gy++) grids.push(await areas(map, gx, gy));
        const lookup: AreaLookup = (x, y) => {
          const { gx, gy } = gridOf(x, y);
          const file = gx >= gx0 && gx < gx0 + span && gy >= gy0 && gy < gy0 + span ? grids[(gx - gx0) * span + (gy - gy0)] : null;
          return file ? areaAt(file, x, y) : null;
        };
        const art = await client.art(map, tx, ty, lookup);
        if (!art) return (await relief(map, zoom, tx, ty)).pixels;
        // The relief is slow to draw; it is only needed where the art leaves a gap.
        let covered = true;
        for (let i = 3; i < art.length && covered; i += 4) covered = art[i]! >= ART_ALPHA;
        if (covered) return art;
        const base = await relief(map, zoom, tx, ty);
        const out = base.pixels ? Uint8Array.from(base.pixels) : emptyPixels();
        for (let i = 0; i < out.length; i += 4) {
          if (art[i + 3]! < ART_ALPHA) continue;
          out[i] = art[i]!;
          out[i + 1] = art[i + 1]!;
          out[i + 2] = art[i + 2]!;
          out[i + 3] = 255;
        }
        return out;
      }
      return shrink(four(zoom, tx, ty, (z, x, y) => picture(client, map, z, x, y)));
    });
  }

  function ensureImagery(): Promise<MapImagery | null> {
    if (!clientDir || !deps.openImagery) return Promise.resolve(null);
    if (!imagery) {
      const opening = clientDir;
      imagery = deps.openImagery(opening).then(
        (opened) => {
          if (!opened) warnOnce(`client:${opening}`, `Game client: no archives found in ${opening}; the map shows the relief.`);
          return opened;
        },
        (error: unknown) => {
          warnOnce(`client:${opening}`, `Game client: ${opening} could not be opened: ${error instanceof Error ? error.message : String(error)}`);
          return null;
        },
      );
    }
    return imagery;
  }

  const forget = (): void => {
    generation += 1;
    inFlight.clear();
    rgbaCache.clear();
    gridCache.clear();
    areaCache.clear();
  };

  return {
    setDataDir(next) {
      dir = next && next.trim() !== '' ? next : null;
      folderKey = keyOf(dir);
      forget();
    },
    setClientDir(next) {
      const normalised = next && next.trim() !== '' ? next : null;
      if (normalised === clientDir) return;
      const old = imagery;
      imagery = null;
      void old?.then((opened) => opened?.close()).catch(() => {});
      clientDir = normalised;
      clientKey = keyOf(clientDir);
      forget();
    },
    async tile(map, zoom, tx, ty) {
      if (!dir && !clientDir) return transparent;
      try {
        const asked = generation;
        const client = await ensureImagery();
        // A folder changed while the client was opening: draw with what is set now.
        if (asked !== generation) return await this.tile(map, zoom, tx, ty);
        if (client) return (await picture(client, map, zoom, tx, ty)).png;
        return dir ? (await relief(map, zoom, tx, ty)).png : transparent;
      } catch (error) {
        console.warn(`Map tile ${map}/${zoom}/${tx}/${ty} failed: ${error instanceof Error ? error.message : String(error)}`);
        return transparent;
      }
    },
  };
}
