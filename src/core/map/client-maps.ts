import { dbcString, parseDbc } from '../game/dbc';
import { MAP_FILE } from '../game/maps-dbc';
import { WORLD_MAPS, type MapKind, type WorldMap } from './world-maps';

/**
 * The maps the game client can draw besides the continents: dungeons, raids, battlegrounds, arenas and
 * the other open maps. `Map.dbc` names each map and its terrain folder; the folder's WDT says which
 * ADT tiles it has. A map stored as one building (WDT flag 1) or without a WDT is not drawn yet.
 */

const GRID = 533.3333;
const CORNER = 17066.666;
const TILES = 64;
const MPHD_GLOBAL_WMO = 0x1;
/** `Map.dbc`'s map types, by their value */
const KINDS: MapKind[] = ['world', 'dungeon', 'raid', 'battleground', 'arena'];

/** What a WDT says of its map: whether it is one building, and its occupied tiles (x is the first number of the ADT's file name). */
export function parseWdtLayout(bytes: Uint8Array): { globalWmo: boolean; tiles: { a: number; b: number }[] } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let flags = 0;
  const tiles: { a: number; b: number }[] = [];
  let at = 0;
  while (at + 8 <= bytes.length) {
    const tag = String.fromCharCode(bytes[at + 3]!, bytes[at + 2]!, bytes[at + 1]!, bytes[at]!);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (tag === 'MPHD' && body + 4 <= bytes.length) flags = view.getUint32(body, true);
    if (tag === 'MAIN') {
      for (let i = 0; i < TILES * TILES && body + i * 8 + 4 <= bytes.length; i++) {
        if (view.getUint32(body + i * 8, true) & 1) tiles.push({ a: i % TILES, b: Math.floor(i / TILES) });
      }
    }
    at = body + size;
  }
  return { globalWmo: (flags & MPHD_GLOBAL_WMO) !== 0, tiles };
}

/** The middle of a tile in the world: `a` is the first number of its file name (along Y), `b` the second (along X). */
export const tileCentre = (tile: { a: number; b: number }): { x: number; y: number } => ({
  x: CORNER - (tile.b + 0.5) * GRID,
  y: CORNER - (tile.a + 0.5) * GRID,
});

const knownIds = new Set(WORLD_MAPS.map((m) => m.id));

/**
 * The maps beyond the continents that the client holds terrain for, from its `Map.dbc` and a reader of
 * its files. Each starts at the middle of the tile nearest the middle of the map's tiles, at height 0.
 */
export async function buildClientMaps(mapDbc: Uint8Array, readFile: (path: string) => Promise<Uint8Array | null>): Promise<WorldMap[]> {
  const table = parseDbc(mapDbc, MAP_FILE);
  const maps: WorldMap[] = [];
  for (const r of table.records) {
    const id = r[0]!;
    if (knownIds.has(id)) continue;
    const directory = dbcString(mapDbc, r[1]!);
    if (!directory) continue;
    const wdt = await readFile(`world/maps/${directory}/${directory}.wdt`);
    if (!wdt) continue;
    const layout = parseWdtLayout(wdt);
    if (layout.globalWmo || layout.tiles.length === 0) continue;
    const mean = (pick: (t: { a: number; b: number }) => number): number => layout.tiles.reduce((s, t) => s + pick(t), 0) / layout.tiles.length;
    const ma = mean((t) => t.a);
    const mb = mean((t) => t.b);
    const nearest = layout.tiles.reduce((best, t) => (Math.hypot(t.a - ma, t.b - mb) < Math.hypot(best.a - ma, best.b - mb) ? t : best));
    maps.push({ id, name: dbcString(mapDbc, r[5]!) || directory, directory, kind: KINDS[r[2]!] ?? 'world', start: { ...tileCentre(nearest), z: 0 } });
  }
  return maps.sort((x, y) => x.name.localeCompare(y.name));
}
