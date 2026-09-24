import { deflateSync, inflateSync } from 'node:zlib';

/** RGBA pixels as a PNG file: one IDAT, no filtering. Main process only (it needs `node:zlib`). */

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA, deflate, no filter method, no interlace
  const stride = width * 4;
  const raw = new Uint8Array(height * (1 + stride));
  for (let row = 0; row < height; row++) raw.set(rgba.subarray(row * stride, (row + 1) * stride), row * (1 + stride) + 1);
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', new Uint8Array(deflateSync(raw))),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Pixels of a PNG this file wrote (8-bit RGBA, no filtering), or null for anything else. */
export function decodeOwnPng(png: Uint8Array): { width: number; height: number; rgba: Uint8Array } | null {
  if (png.length < 33 || png[0] !== 137 || png[1] !== 80) return null;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (png[24] !== 8 || png[25] !== 6) return null;
  const idat: Uint8Array[] = [];
  let at = 8;
  while (at + 8 <= png.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(png[at + 4]!, png[at + 5]!, png[at + 6]!, png[at + 7]!);
    if (type === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const joined = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of idat) {
    joined.set(c, o);
    o += c.length;
  }
  let raw: Uint8Array;
  try {
    raw = new Uint8Array(inflateSync(joined));
  } catch {
    return null; // a damaged cache file: the caller draws the tile again
  }
  const stride = width * 4;
  if (raw.length !== height * (1 + stride)) return null;
  const rgba = new Uint8Array(height * stride);
  for (let row = 0; row < height; row++) {
    if (raw[row * (1 + stride)] !== 0) return null;
    rgba.set(raw.subarray(row * (1 + stride) + 1, (row + 1) * (1 + stride)), row * stride);
  }
  return { width, height, rgba };
}
