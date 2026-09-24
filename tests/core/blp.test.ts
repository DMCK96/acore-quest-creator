import { describe, expect, it } from 'vitest';
import { BlpFormatError, decodeBlp, scaleRgba, type RgbaImage } from '../../src/core/client/blp';
import { buildBlp } from '../helpers/blp-file';

const px = (img: RgbaImage, x: number, y: number): number[] => Array.from(img.rgba.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));
const u16 = (v: number): number[] => [v & 0xff, v >> 8];
const RED = 0xf800;
const BLUE = 0x001f;
/** One DXT colour block: two 565 colours, then a row byte per pixel row (pixel x uses bits 2x, 2x+1). */
const colourBlock = (c0: number, c1: number, rows: number[]): number[] => [...u16(c0), ...u16(c1), ...rows];

describe('BLP decoding', () => {
  it('turns raw BGRA into RGBA', () => {
    const img = decodeBlp(buildBlp({ width: 2, height: 1, compression: 'raw', data: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]) }));
    expect([img.width, img.height]).toEqual([2, 1]);
    expect(px(img, 0, 0)).toEqual([3, 2, 1, 4]);
    expect(px(img, 1, 0)).toEqual([7, 6, 5, 8]);
  });
  it('reads palette images with no alpha as opaque', () => {
    const img = decodeBlp(buildBlp({ width: 2, height: 2, compression: 'palette', alphaDepth: 0, palette: [[10, 20, 30, 0], [40, 50, 60, 0]], data: Uint8Array.from([0, 1, 1, 0]) }));
    expect(px(img, 1, 0)).toEqual([60, 50, 40, 255]);
    expect(px(img, 1, 1)).toEqual([30, 20, 10, 255]);
  });
  it('reads 8-, 1- and 4-bit palette alpha', () => {
    const pal: [number, number, number, number][] = [[0, 0, 0, 0]];
    const a8 = decodeBlp(buildBlp({ width: 2, height: 2, compression: 'palette', alphaDepth: 8, palette: pal, data: Uint8Array.from([0, 0, 0, 0, 0, 64, 128, 255]) }));
    expect([0, 1, 2, 3].map((i) => px(a8, i % 2, i >> 1)[3])).toEqual([0, 64, 128, 255]);
    const a1 = decodeBlp(buildBlp({ width: 2, height: 2, compression: 'palette', alphaDepth: 1, palette: pal, data: Uint8Array.from([0, 0, 0, 0, 0b0101]) }));
    expect([0, 1, 2, 3].map((i) => px(a1, i % 2, i >> 1)[3])).toEqual([255, 0, 255, 0]);
    const a4 = decodeBlp(buildBlp({ width: 2, height: 2, compression: 'palette', alphaDepth: 4, palette: pal, data: Uint8Array.from([0, 0, 0, 0, 0xf0, 0x51]) }));
    expect([0, 1, 2, 3].map((i) => px(a4, i % 2, i >> 1)[3])).toEqual([0, 255, 17, 85]);
  });
  it('decodes DXT1 with four colours', () => {
    const img = decodeBlp(buildBlp({ width: 4, height: 4, compression: 'dxt1', data: Uint8Array.from(colourBlock(RED, BLUE, [0b11100100, 0, 0, 0])) }));
    expect(px(img, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(img, 1, 0)).toEqual([0, 0, 255, 255]);
    expect(px(img, 2, 0)).toEqual([170, 0, 85, 255]);
    expect(px(img, 3, 0)).toEqual([85, 0, 170, 255]);
    expect(px(img, 0, 3)).toEqual([255, 0, 0, 255]);
  });
  it('decodes DXT1 with three colours and a see-through fourth, unless the image has no alpha', () => {
    const block = Uint8Array.from(colourBlock(BLUE, RED, [0b11100100, 0, 0, 0]));
    const withAlpha = decodeBlp(buildBlp({ width: 4, height: 4, compression: 'dxt1', alphaDepth: 1, data: block }));
    expect(px(withAlpha, 2, 0)).toEqual([127, 0, 127, 255]);
    expect(px(withAlpha, 3, 0)[3]).toBe(0);
    const opaque = decodeBlp(buildBlp({ width: 4, height: 4, compression: 'dxt1', alphaDepth: 0, data: block }));
    expect(px(opaque, 3, 0)).toEqual([0, 0, 0, 255]);
  });
  it('decodes DXT3 explicit alpha', () => {
    const img = decodeBlp(buildBlp({ width: 4, height: 4, compression: 'dxt3', alphaDepth: 8, data: Uint8Array.from([0xf0, 0, 0, 0, 0, 0, 0, 0, ...colourBlock(RED, BLUE, [0, 0, 0, 0])]) }));
    expect(px(img, 0, 0)).toEqual([255, 0, 0, 0]);
    expect(px(img, 1, 0)).toEqual([255, 0, 0, 255]);
  });
  it('decodes DXT5 interpolated alpha', () => {
    const img = decodeBlp(buildBlp({ width: 4, height: 4, compression: 'dxt5', alphaDepth: 8, data: Uint8Array.from([255, 0, 0b001, 0, 0, 0, 0, 0, ...colourBlock(RED, BLUE, [0, 0, 0, 0])]) }));
    expect(px(img, 0, 0)[3]).toBe(0);
    expect(px(img, 1, 0)[3]).toBe(255);
  });
  it('places each DXT block', () => {
    const img = decodeBlp(buildBlp({ width: 8, height: 4, compression: 'dxt1', data: Uint8Array.from([...colourBlock(RED, BLUE, [0, 0, 0, 0]), ...colourBlock(BLUE, RED, [0, 0, 0, 0])]) }));
    expect(px(img, 3, 3)).toEqual([255, 0, 0, 255]);
    expect(px(img, 4, 0)).toEqual([0, 0, 255, 255]);
  });
  it('rejects a file that is not BLP2', () => {
    expect(() => decodeBlp(new TextEncoder().encode('BLP1 and some more bytes'))).toThrow(BlpFormatError);
  });
  it('scales an image, keeping its corners', () => {
    const src: RgbaImage = { width: 2, height: 2, rgba: Uint8Array.from([255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 255, 255, 255, 255, 255]) };
    const big = scaleRgba(src, 4, 4);
    expect([big.width, big.height]).toEqual([4, 4]);
    expect(px(big, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(big, 3, 0)).toEqual([0, 0, 255, 255]);
    expect(px(big, 0, 3)).toEqual([0, 255, 0, 255]);
    expect(px(big, 3, 3)).toEqual([255, 255, 255, 255]);
  });
});
