import { describe, expect, it } from 'vitest';
import type { RgbaImage } from '../../src/core/client/blp';
import { composeArtTile, loadZoneArt, parseAreaParents, parseWorldMapAreas, zoneFinder, type ZoneArt } from '../../src/core/map/world-art';
import { buildDbcWithStrings, f32 } from '../helpers/dbc';
import { solidBlp } from '../helpers/blp-file';

const NONE = 0xffffffff;
const wma = buildDbcWithStrings([
  [14, 0, 0, 'Azeroth', f32(18171), f32(-22569), f32(11176), f32(-15973), NONE, 0, 0],
  [30, 0, 12, 'Elwynn', f32(1535), f32(-1935), f32(-7939), f32(-10254), NONE, 0, 0],
  [31, 0, 1519, 'Stormwind', f32(1644), f32(-1540), f32(-8120), f32(-9240), NONE, 0, 0],
  [13, 1, 0, 'Kalimdor', f32(17066), f32(-19733), f32(12799), f32(-11733), NONE, 0, 0],
], 11);

const solid = (width: number, height: number, c: number[]): RgbaImage => {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) rgba.set(c, i * 4);
  return { width, height, rgba };
};
/** Quadrants: top-left red, top-right yellow, bottom-left cyan, bottom-right magenta (split at 501, 334 of 1024 × 768). */
const quadrants = (): RgbaImage => {
  const img = solid(1024, 768, [0, 0, 0, 255]);
  for (let y = 0; y < 768; y++) for (let x = 0; x < 1024; x++) {
    const c = y < 334 ? (x < 501 ? [255, 0, 0, 255] : [255, 255, 0, 255]) : x < 501 ? [0, 255, 255, 255] : [255, 0, 255, 255];
    img.rgba.set(c, (y * 1024 + x) * 4);
  }
  return img;
};
const px = (rgba: Uint8Array, x: number, y: number): number[] => Array.from(rgba.subarray((y * 256 + x) * 4, (y * 256 + x) * 4 + 4));

// Zoom-5 tile (16, 16) covers world x and y from 0 down to -1066.67: pixel (col, row) is at x = -(row + 0.5) * 4.1667, y = -(col + 0.5) * 4.1667.
const A: ZoneArt = { id: 1, map: 0, area: 10, name: 'A', west: 100, east: -1200, north: 100, south: -1200 };
const B: ZoneArt = { id: 2, map: 0, area: 20, name: 'B', west: 50, east: -1100, north: 50, south: -1100 };
const C: ZoneArt = { id: 3, map: 0, area: 0, name: 'C', west: 5000, east: -5000, north: 5000, south: -5000 };

describe('world map areas', () => {
  it('reads each zone box and art folder', () => {
    const zones = parseWorldMapAreas(wma);
    expect(zones[1]).toEqual({ id: 30, map: 0, area: 12, name: 'Elwynn', west: 1535, east: -1935, north: -7939, south: -10254 });
    expect(zones).toHaveLength(4);
  });
  it('finds the zone of an area through its parents, the continent, and the smallest box where there is no area data', () => {
    const parents = parseAreaParents(buildDbcWithStrings([[9, 0, 12], [12, 0, 0], [1519, 0, 0], [5000, 0, 9], [7, 0, 8], [8, 0, 7]], 3));
    const finder = zoneFinder(parseWorldMapAreas(wma), parents, 0);
    expect(finder.continent?.name).toBe('Azeroth');
    expect(finder.zones.map((z) => z.name)).toEqual(['Elwynn', 'Stormwind']);
    expect(finder.zoneAt(-9000, 0, 5000)?.name).toBe('Elwynn');
    expect(finder.zoneAt(-9000, 0, 1519)?.name).toBe('Stormwind');
    expect(finder.zoneAt(-9000, 0, 0)).toBeNull();
    expect(finder.zoneAt(-9000, 0, 7)).toBeNull();
    expect(finder.zoneAt(-9000, 0, null)?.name).toBe('Stormwind');
    expect(finder.zoneAt(-10000, 1000, null)?.name).toBe('Elwynn');
    expect(finder.zoneAt(0, 0, null)).toBeNull();
    expect(zoneFinder(parseWorldMapAreas(wma), parents, 1).zones).toEqual([]);
  });
});

describe('zone art', () => {
  it('assembles the 12 tiles, four across and three down', async () => {
    const colour = (i: number): [number, number, number, number] => [i * 10, 0, 0, 255];
    const read = async (path: string): Promise<Uint8Array | null> => {
      const m = /^Interface\\WorldMap\\A\\A(\d+)\.blp$/.exec(path);
      return m && m[1] !== '7' ? solidBlp(8, 8, colour(Number(m[1]))) : null;
    };
    const img = (await loadZoneArt(read, 'A'))!;
    expect([img.width, img.height]).toEqual([32, 24]);
    expect(Array.from(img.rgba.subarray((1 * 32 + 10) * 4, (1 * 32 + 10) * 4 + 4))).toEqual(colour(2));
    expect(Array.from(img.rgba.subarray((20 * 32 + 1) * 4, (20 * 32 + 1) * 4 + 4))).toEqual(colour(9));
    expect(img.rgba[(12 * 32 + 20) * 4 + 3]).toBe(0);
  });
  it("scales tiles of another size to the first tile's size", async () => {
    const read = async (path: string): Promise<Uint8Array | null> => (/A1\.blp$/.test(path) ? solidBlp(8, 8, [1, 2, 3, 255]) : /A2\.blp$/.test(path) ? solidBlp(16, 16, [9, 9, 9, 255]) : null);
    const img = (await loadZoneArt(read, 'A'))!;
    expect([img.width, img.height]).toEqual([32, 24]);
    expect(Array.from(img.rgba.subarray((2 * 32 + 12) * 4, (2 * 32 + 12) * 4 + 4))).toEqual([9, 9, 9, 255]);
  });
  it('is null when a zone has no art', async () => {
    expect(await loadZoneArt(async () => null, 'Nowhere')).toBeNull();
  });
});

describe('art tiles', () => {
  const images = new Map<string, RgbaImage>([['A', solid(1024, 768, [255, 0, 0, 255])], ['B', solid(1024, 768, [0, 255, 0, 255])], ['C', solid(1024, 768, [0, 0, 255, 255])]]);
  const image = (z: ZoneArt): RgbaImage | null => images.get(z.name) ?? null;

  it('paints each pixel from the zone its ground belongs to, and the sea from the continent', () => {
    const tile = composeArtTile({ tx: 16, ty: 16, continent: C, image, zoneAt: (x, y) => (x < -900 ? null : y > -533 ? A : B) });
    expect(tile).toHaveLength(256 * 256 * 4);
    expect(px(tile, 10, 10)).toEqual([255, 0, 0, 255]);
    expect(px(tile, 200, 10)).toEqual([0, 255, 0, 255]);
    expect(px(tile, 10, 240)).toEqual([0, 0, 255, 255]);
  });
  it('places the art by the zone box', () => {
    const tile = composeArtTile({ tx: 16, ty: 16, continent: null, image: () => quadrants(), zoneAt: () => A });
    expect(px(tile, 128, 10)).toEqual([255, 0, 0, 255]);
    expect(px(tile, 134, 10)).toEqual([255, 255, 0, 255]);
    expect(px(tile, 10, 125)).toEqual([255, 0, 0, 255]);
    expect(px(tile, 10, 140)).toEqual([0, 255, 255, 255]);
  });
  it('falls back to the continent where zone art is missing or see-through, and leaves the rest clear', () => {
    const clear = new Map(images);
    clear.set('A', solid(1024, 768, [255, 0, 0, 0]));
    const noB = composeArtTile({ tx: 16, ty: 16, continent: C, image: (z) => (z.name === 'B' ? null : (clear.get(z.name) ?? null)), zoneAt: (_x, y) => (y > -533 ? A : B) });
    expect(px(noB, 10, 10)).toEqual([0, 0, 255, 255]);
    expect(px(noB, 200, 10)).toEqual([0, 0, 255, 255]);
    const bare = composeArtTile({ tx: 16, ty: 16, continent: null, image, zoneAt: () => null });
    expect(px(bare, 10, 10)[3]).toBe(0);
  });
});
