import { inflateSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import type { MapImagery } from '../../src/main/client-imagery';
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

function rgbaAt(png: Uint8Array, col: number, row: number): number[] {
  const view = new DataView(png.buffer, png.byteOffset);
  const width = view.getUint32(16);
  const idat = png.indexOf(0x49, 33);
  const raw = inflateSync(png.slice(idat + 4, idat + 4 + view.getUint32(idat - 4)));
  const at = row * (1 + width * 4) + 1 + col * 4;
  return Array.from(raw.subarray(at, at + 4));
}

/** A 256 px tile of one colour in columns [0, cols). */
function solidTile(r: number, g: number, b: number, cols = 256): Uint8Array {
  const px = new Uint8Array(256 * 256 * 4);
  for (let row = 0; row < 256; row++) for (let col = 0; col < cols; col++) px.set([r, g, b, 255], (row * 256 + col) * 4);
  return px;
}

function setupWithClient(
  overrides: Partial<MapImagery> = {},
  open?: (dir: string) => Promise<MapImagery | null>,
  stored = new Map<string, Uint8Array>(),
) {
  const grid = buildMapFile({ kind: 'flat', gridHeight: 50, area: { gridArea: 12 } });
  const files: ServerDataFiles = {
    isDir: async (d) => d === '/data',
    read: async (d, name) => (d.replace(/\\/g, '/') === '/data/maps' && name === '0003232.map' ? grid : null),
  };
  const areas: (number | null)[] = [];
  let opened = 0;
  const imagery: MapImagery = {
    minimap: async (_map, gx, gy) => (gx === 32 && gy === 32 ? solidTile(10, 20, 30) : null),
    art: async (_map, _tx, _ty, areaAt) => {
      areas.push(areaAt(-10, -10), areaAt(-600, -10));
      return solidTile(200, 0, 0, 64);
    },
    close: vi.fn(async () => {}),
    archives: ['common.MPQ'],
    fingerprint: 'common.MPQ:100:0',
    problems: [],
    ...overrides,
  };
  const tiles = createMapTiles({
    files,
    cacheRoot: '/cache',
    cache: { read: async (p) => stored.get(p) ?? null, write: async (p, b) => void stored.set(p, b) },
    openImagery: open ?? (async (dir) => {
      opened += 1;
      return dir === '/client' ? imagery : null;
    }),
  });
  return { tiles, stored, areas, imagery, opened: () => opened };
}

describe('map tiles from the game client', () => {
  it('draws the minimap at zoom 6', async () => {
    const { tiles } = setupWithClient();
    tiles.setDataDir('/data');
    tiles.setClientDir('/client');
    expect(rgbaAt(await tiles.tile(0, 6, 32, 32), 100, 100)).toEqual([10, 20, 30, 255]);
  });
  it('draws the relief where a grid has no minimap tile', async () => {
    const withClient = setupWithClient({ minimap: async () => null });
    withClient.tiles.setDataDir('/data');
    withClient.tiles.setClientDir('/client');
    const reliefOnly = setup();
    reliefOnly.tiles.setDataDir('/data');
    expect(rgbaAt(await withClient.tiles.tile(0, 6, 32, 32), 100, 100)).toEqual(rgbaAt(await reliefOnly.tiles.tile(0, 6, 32, 32), 100, 100));
  });
  it('lays the painted art over the relief at zoom 5 and tells it the areas', async () => {
    const { tiles, areas } = setupWithClient();
    tiles.setDataDir('/data');
    tiles.setClientDir('/client');
    const png = await tiles.tile(0, 5, 16, 16);
    expect(rgbaAt(png, 10, 10)).toEqual([200, 0, 0, 255]);
    expect(rgbaAt(png, 100, 100)[3]).toBe(255);
    expect(rgbaAt(png, 100, 100)).not.toEqual([200, 0, 0, 255]);
    expect(rgbaAt(png, 200, 200)[3]).toBe(0);
    expect(areas).toEqual([12, null]);
  });
  it('does not draw the relief under art that covers the whole tile', async () => {
    const { tiles, stored } = setupWithClient({ art: async () => solidTile(200, 0, 0) });
    tiles.setDataDir('/data');
    tiles.setClientDir('/client');
    expect(rgbaAt(await tiles.tile(0, 5, 16, 16), 100, 100)).toEqual([200, 0, 0, 255]);
    expect([...stored.keys()].some((k) => k.includes('/r2/'))).toBe(false);
  });
  it('builds zoom 4 from the painted tiles', async () => {
    const { tiles } = setupWithClient();
    tiles.setDataDir('/data');
    tiles.setClientDir('/client');
    expect(rgbaAt(await tiles.tile(0, 4, 8, 8), 2, 2)).toEqual([200, 0, 0, 255]);
  });
  it('serves the minimap without a server data folder', async () => {
    const { tiles } = setupWithClient();
    tiles.setClientDir('/client');
    expect(rgbaAt(await tiles.tile(0, 6, 32, 32), 5, 5)).toEqual([10, 20, 30, 255]);
    expect(alphaAt(await tiles.tile(0, 6, 0, 0), 5, 5)).toBe(0);
  });
  it('opens the client once however many tiles are asked for at once', async () => {
    const { tiles, opened } = setupWithClient();
    tiles.setClientDir('/client');
    await Promise.all([tiles.tile(0, 6, 32, 32), tiles.tile(0, 6, 31, 32), tiles.tile(0, 6, 32, 31), tiles.tile(0, 5, 16, 16)]);
    expect(opened()).toBe(1);
  });
  it('closes the old client and draws fresh tiles when the folder changes', async () => {
    const { tiles, stored, imagery } = setupWithClient();
    tiles.setDataDir('/data');
    tiles.setClientDir('/client');
    expect(rgbaAt(await tiles.tile(0, 6, 32, 32), 5, 5)).toEqual([10, 20, 30, 255]);
    tiles.setClientDir('/elsewhere');
    await Promise.resolve();
    expect(imagery.close).toHaveBeenCalledTimes(1);
    expect(rgbaAt(await tiles.tile(0, 6, 32, 32), 5, 5)).not.toEqual([10, 20, 30, 255]);
    expect([...stored.keys()].some((k) => k.includes('/r3/'))).toBe(true);
    expect([...stored.keys()].some((k) => k.includes('/r2/'))).toBe(true);
  });
  it('does not cache a tile whose client folder changed while it was drawn', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { tiles, stored } = setupWithClient({
      minimap: async () => {
        await gate;
        return solidTile(10, 20, 30);
      },
    });
    tiles.setClientDir('/client');
    const pending = tiles.tile(0, 6, 32, 32);
    await new Promise((resolve) => setTimeout(resolve, 0));
    tiles.setClientDir('/elsewhere');
    release();
    await pending;
    expect([...stored.keys()].filter((k) => k.includes('/r3/'))).toEqual([]);
  });
  it('draws with the new client when the folder changes while the old one is still opening', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const clientB: MapImagery = { minimap: async () => solidTile(90, 90, 90), art: async () => null, close: async () => {}, archives: [], fingerprint: 'b', problems: [] };
    const { tiles, imagery } = setupWithClient({}, async (dir) => {
      if (dir === '/client') {
        await gate;
        return imagery;
      }
      return clientB;
    });
    tiles.setClientDir('/client');
    const pending = tiles.tile(0, 6, 32, 32);
    await new Promise((resolve) => setTimeout(resolve, 0));
    tiles.setClientDir('/b');
    release();
    expect(rgbaAt(await pending, 5, 5)).toEqual([90, 90, 90, 255]);
  });
  it('falls back to the relief when the client cannot be opened', async () => {
    const { tiles } = setupWithClient({}, async () => {
      throw new Error('disk on fire');
    });
    tiles.setDataDir('/data');
    tiles.setClientDir('/client');
    expect(alphaAt(await tiles.tile(0, 6, 32, 32), 100, 100)).toBe(255);
  });
  it('shares the cache between spellings of the same client folder', async () => {
    const stored = new Map<string, Uint8Array>();
    const first = setupWithClient({}, undefined, stored);
    first.tiles.setClientDir('/client');
    await first.tiles.tile(0, 6, 32, 32);
    const minimap = vi.fn(async () => solidTile(1, 2, 3));
    const second = setupWithClient({ minimap }, async (dir) => (dir.replace(/\\/g, '/').replace(/\/+$/, '') === '/client' ? second.imagery : null), stored);
    second.tiles.setClientDir('\\client\\');
    expect(rgbaAt(await second.tiles.tile(0, 6, 32, 32), 5, 5)).toEqual([10, 20, 30, 255]);
    expect(minimap).not.toHaveBeenCalled();
  });
  it('draws the picture afresh once the client is patched', async () => {
    const stored = new Map<string, Uint8Array>();
    const before = setupWithClient({}, undefined, stored);
    before.tiles.setClientDir('/client');
    await before.tiles.tile(0, 6, 32, 32);
    const after = setupWithClient({ minimap: async () => solidTile(1, 2, 3), fingerprint: 'patch-4.MPQ:9:1' }, undefined, stored);
    after.tiles.setClientDir('/client');
    expect(rgbaAt(await after.tiles.tile(0, 6, 32, 32), 5, 5)).toEqual([1, 2, 3, 255]);
  });
});

describe('game client status', () => {
  it('is null without a client folder', async () => {
    const { tiles } = setupWithClient();
    expect(await tiles.clientStatus()).toBeNull();
  });
  it('lists the archives read and any problems', async () => {
    const { tiles } = setupWithClient({ problems: ['patch-Z.MPQ could not be opened'] });
    tiles.setClientDir('/client');
    expect(await tiles.clientStatus()).toEqual({ dir: '/client', archives: ['common.MPQ'], problems: ['patch-Z.MPQ could not be opened'] });
  });
  it('says so when the folder holds no game archives', async () => {
    const { tiles } = setupWithClient();
    tiles.setClientDir('/elsewhere');
    const status = (await tiles.clientStatus())!;
    expect(status.archives).toEqual([]);
    expect(status.problems[0]).toMatch(/No game archives/);
  });
  it('says so when the client cannot be opened', async () => {
    const { tiles } = setupWithClient({}, async () => {
      throw new Error('disk on fire');
    });
    tiles.setClientDir('/client');
    expect((await tiles.clientStatus())!.problems[0]).toMatch(/disk on fire/);
  });
});
