import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseMapFile } from '../../src/core/game/terrain';
import { downsample, emptyPixels, reliefPixels } from '../../src/core/map/relief';
import { encodePng } from '../../src/core/map/png';
import { buildMapFile } from '../helpers/map-file';

const px = (rgba: Uint8Array, col: number, row: number) => Array.from(rgba.slice((row * 256 + col) * 4, (row * 256 + col) * 4 + 4));
const brightness = (rgba: Uint8Array) => {
  let sum = 0;
  for (let i = 0; i < rgba.length; i += 4) sum += rgba[i]! + rgba[i + 1]! + rgba[i + 2]!;
  return sum / (rgba.length / 4);
};
// Mirror-image slopes over the same heights, so only the light (not the height tint) can tell them apart.
const graded = (dir: 1 | -1) => parseMapFile(buildMapFile({
  kind: 'float', gridHeight: 0,
  v9: (i, j) => 100 + 0.2 * (dir === 1 ? i + j : 256 - i - j),
  v8: (i, j) => 100 + 0.2 * (dir === 1 ? i + j + 1 : 255 - i - j),
}));

describe('relief', () => {
  it('leaves a grid without terrain transparent', () => {
    const rgba = reliefPixels(null, 32, 32);
    expect(rgba.length).toBe(256 * 256 * 4);
    expect(rgba.every((v, i) => i % 4 !== 3 || v === 0)).toBe(true);
  });
  it('draws flat ground as one opaque colour', () => {
    const rgba = reliefPixels(parseMapFile(buildMapFile({ kind: 'flat', gridHeight: 50 })), 32, 32);
    expect(px(rgba, 0, 0)).toEqual(px(rgba, 200, 130));
    expect(px(rgba, 0, 0)[3]).toBe(255);
  });
  it('lights slopes that face the north-west more than slopes facing the south-east', () => {
    // v9(i, j): i grows southward, j eastward. Rising to the south-east means the face looks north-west.
    expect(brightness(reliefPixels(graded(1), 32, 32))).toBeGreaterThan(brightness(reliefPixels(graded(-1), 32, 32)));
  });
  it('shades the last row and column of a grid like the rest of an even slope, so grid edges do not show', () => {
    const rgba = reliefPixels(graded(1), 32, 32);
    expect(px(rgba, 255, 100)).toEqual(px(rgba, 254, 100));
    expect(px(rgba, 100, 255)).toEqual(px(rgba, 100, 254));
  });
  it('draws water above the ground in blue', () => {
    const file = parseMapFile(buildMapFile({ kind: 'flat', gridHeight: 10, liquid: { flags: 1, level: 12 } }));
    const [r, g, b] = px(reliefPixels(file, 32, 32), 100, 100);
    expect(b).toBeGreaterThan(r!);
    expect(b).toBeGreaterThan(g!);
  });
  it('leaves holes transparent', () => {
    const holes = new Uint16Array(256);
    holes[0] = 0xffff;
    const file = parseMapFile(buildMapFile({ kind: 'flat', gridHeight: 10, holes }));
    const rgba = reliefPixels(file, 32, 32);
    expect(px(rgba, 1, 1)[3]).toBe(0);
    expect(px(rgba, 200, 200)[3]).toBe(255);
  });
  it('shrinks four tiles into one, quadrant by quadrant', () => {
    const solid = (c: number) => { const a = new Uint8Array(256 * 256 * 4); for (let i = 0; i < a.length; i += 4) a.set([c, c, c, 255], i); return a; };
    const out = downsample([solid(10), solid(20), null, solid(40)]);
    expect(px(out, 10, 10)).toEqual([10, 10, 10, 255]);
    expect(px(out, 200, 10)).toEqual([20, 20, 20, 255]);
    expect(px(out, 10, 200)[3]).toBe(0);
    expect(px(out, 200, 200)).toEqual([40, 40, 40, 255]);
    expect(emptyPixels().every((v) => v === 0)).toBe(true);
  });
});

describe('png', () => {
  it('writes a valid RGBA PNG', () => {
    const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128]);
    const png = encodePng(2, 1, rgba);
    expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(png.buffer, png.byteOffset);
    expect(String.fromCharCode(...png.slice(12, 16))).toBe('IHDR');
    expect([view.getUint32(16), view.getUint32(20), png[24], png[25]]).toEqual([2, 1, 8, 6]);
    const idatAt = png.indexOf(0x49, 33); // 'I' of IDAT
    expect(String.fromCharCode(...png.slice(idatAt, idatAt + 4))).toBe('IDAT');
    const len = view.getUint32(idatAt - 4);
    const raw = inflateSync(png.slice(idatAt + 4, idatAt + 4 + len));
    expect(Array.from(raw)).toEqual([0, 255, 0, 0, 255, 0, 255, 0, 128]);
    expect(String.fromCharCode(...png.slice(png.length - 8, png.length - 4))).toBe('IEND');
  });
});
