import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createMapTiles, parseTileUrl } from '../../src/main/map-tiles';
import type { ServerDataFiles } from '../../src/main/server-data';
import { buildMapFile } from '../helpers/map-file';

/** Alpha of pixel (col, row) of a PNG made by encodePng (one IDAT, filter 0). */
function alphaAt(png: Uint8Array, col: number, row: number): number {
  const view = new DataView(png.buffer, png.byteOffset);
  const width = view.getUint32(16);
  const idat = png.indexOf(0x49, 33);
  const raw = inflateSync(png.slice(idat + 4, idat + 4 + view.getUint32(idat - 4)));
  return raw[row * (1 + width * 4) + 1 + col * 4 + 3]!;
}

function setup() {
  let reads = 0;
  const grid = buildMapFile({ kind: 'flat', gridHeight: 50 });
  const files: ServerDataFiles = {
    isDir: async (d) => d === '/data',
    read: async (d, name) => {
      reads += 1;
      return d.replace(/\\/g, '/') === '/data/maps' && name === '0003232.map' ? grid : null;
    },
  };
  const stored = new Map<string, Uint8Array>();
  const tiles = createMapTiles({ files, cacheRoot: '/cache', cache: { read: async (p) => stored.get(p) ?? null, write: async (p, b) => void stored.set(p, b) } });
  return { tiles, reads: () => reads, stored };
}

describe('map tiles', () => {
  it('parses tile addresses', () => {
    expect(parseTileUrl('acqc-map://tile/0/6/32/48.png')).toEqual({ map: 0, zoom: 6, tx: 32, ty: 48 });
    expect(parseTileUrl('acqc-map://tile/0/9/1/1.png')).toBeNull();
    expect(parseTileUrl('acqc-map://tile/x/6/1/1.png')).toBeNull();
  });
  it('draws a grid at full zoom and nothing where there is no grid', async () => {
    const { tiles } = setup();
    tiles.setDataDir('/data');
    expect(alphaAt(await tiles.tile(0, 6, 32, 32), 100, 100)).toBe(255);
    expect(alphaAt(await tiles.tile(0, 6, 0, 0), 100, 100)).toBe(0);
  });
  it('builds zoomed-out tiles from the grids inside them', async () => {
    const { tiles } = setup();
    tiles.setDataDir('/data');
    const png = await tiles.tile(0, 5, 16, 16);
    expect(alphaAt(png, 10, 10)).toBe(255);
    expect(alphaAt(png, 200, 200)).toBe(0);
  });
  it('caches tiles on disk per data folder', async () => {
    const { tiles, reads, stored } = setup();
    tiles.setDataDir('/data');
    await tiles.tile(0, 6, 32, 32);
    const after = reads();
    await tiles.tile(0, 6, 32, 32);
    expect(reads()).toBe(after);
    expect([...stored.keys()].some((k) => k.startsWith('/cache/') && k.endsWith('0/6/32/32.png'))).toBe(true);
  });
  it('returns transparent tiles without a data folder or with a broken grid file', async () => {
    const { tiles } = setup();
    tiles.setDataDir(null);
    expect(alphaAt(await tiles.tile(0, 6, 32, 32), 100, 100)).toBe(0);
    const broken = createMapTiles({ files: { isDir: async () => true, read: async () => new Uint8Array([1, 2, 3]) }, cacheRoot: '/c', cache: { read: async () => null, write: async () => {} } });
    broken.setDataDir('/data');
    expect(alphaAt(await broken.tile(0, 6, 32, 32), 100, 100)).toBe(0);
  });
  it('reads a grid once when the same tile is asked for twice at the same time', async () => {
    const { tiles, reads } = setup();
    tiles.setDataDir('/data');
    await Promise.all([tiles.tile(0, 6, 32, 32), tiles.tile(0, 6, 32, 32)]);
    expect(reads()).toBe(1);
  });
  it('builds a zoomed-out tile from the tiles already drawn, not from the grids again', async () => {
    const grid = buildMapFile({ kind: 'flat', gridHeight: 50 });
    let reads = 0;
    const files: ServerDataFiles = { isDir: async () => true, read: async (_d, name) => { reads += 1; return name === '0003232.map' ? grid : null; } };
    const stored = new Map<string, Uint8Array>();
    const cache = { read: async (p: string) => stored.get(p) ?? null, write: async (p: string, b: Uint8Array) => void stored.set(p, b) };
    const first = createMapTiles({ files, cacheRoot: '/cache', cache });
    first.setDataDir('/data');
    for (const [tx, ty] of [[32, 32], [33, 32], [32, 33], [33, 33]] as const) await first.tile(0, 6, tx, ty);
    // A later session: nothing in memory, the drawn tiles on disk.
    const later = createMapTiles({ files, cacheRoot: '/cache', cache });
    later.setDataDir('/data');
    const before = reads;
    const png = await later.tile(0, 5, 16, 16);
    expect(reads).toBe(before);
    expect(alphaAt(png, 10, 10)).toBe(255);
    expect(alphaAt(png, 200, 200)).toBe(0);
  });
});
