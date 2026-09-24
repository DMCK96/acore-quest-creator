/**
 * BLP2, the client's texture format: mip 0 of a palette, DXT1/3/5 or raw BGRA image, as RGBA.
 * The map uses it for the painted zone art and the minimap tiles.
 */

export interface RgbaImage {
  width: number;
  height: number;
  rgba: Uint8Array;
}

export class BlpFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlpFormatError';
  }
}

const PALETTE = 1;
const DXT = 2;
const RAW = 3;
const DXT3 = 1;
const DXT5 = 7;

export function decodeBlp(bytes: Uint8Array): RgbaImage {
  if (bytes.length < 148 || String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!) !== 'BLP2') {
    throw new BlpFormatError('Not a BLP2 texture.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const compression = bytes[8]!;
  const alphaDepth = bytes[9]!;
  const alphaType = bytes[10]!;
  const width = view.getUint32(12, true);
  const height = view.getUint32(16, true);
  const offset = view.getUint32(20, true);
  const size = view.getUint32(84, true);
  if (offset + size > bytes.length) throw new BlpFormatError('The texture ends before its image.');
  const data = bytes.subarray(offset, offset + size);
  const rgba = new Uint8Array(width * height * 4);
  const count = width * height;

  if (compression === RAW) {
    if (data.length < count * 4) throw new BlpFormatError('The texture ends before its image.');
    for (let i = 0; i < count; i++) rgba.set([data[i * 4 + 2]!, data[i * 4 + 1]!, data[i * 4]!, data[i * 4 + 3]!], i * 4);
  } else if (compression === PALETTE) {
    if (bytes.length < 148 + 1024) throw new BlpFormatError('The texture ends before its palette.');
    const alphaBytes = Math.ceil((count * alphaDepth) / 8);
    if (data.length < count + alphaBytes) throw new BlpFormatError('The texture ends before its image.');
    for (let i = 0; i < count; i++) {
      const p = 148 + data[i]! * 4;
      let a = 255;
      if (alphaDepth === 8) a = data[count + i]!;
      else if (alphaDepth === 1) a = (data[count + (i >> 3)]! >> (i & 7)) & 1 ? 255 : 0;
      else if (alphaDepth === 4) a = ((data[count + (i >> 1)]! >> ((i & 1) * 4)) & 15) * 17;
      rgba.set([bytes[p + 2]!, bytes[p + 1]!, bytes[p]!, a], i * 4);
    }
  } else if (compression === DXT) {
    decodeDxt(data, width, height, alphaType === DXT3 ? 3 : alphaType === DXT5 ? 5 : 1, alphaDepth, rgba);
  } else {
    throw new BlpFormatError(`Texture compression ${compression} is not supported.`);
  }
  return { width, height, rgba };
}

const expand = (c: number): [number, number, number] => [
  Math.floor(((c >> 11) * 255) / 31),
  Math.floor((((c >> 5) & 63) * 255) / 63),
  Math.floor(((c & 31) * 255) / 31),
];

function decodeDxt(data: Uint8Array, width: number, height: number, kind: 1 | 3 | 5, alphaDepth: number, out: Uint8Array): void {
  const blockSize = kind === 1 ? 8 : 16;
  const across = Math.ceil(width / 4);
  const blocks = across * Math.ceil(height / 4);
  if (data.length < blocks * blockSize) throw new BlpFormatError('The texture ends before its image.');
  const alpha = new Uint8Array(16);
  for (let b = 0; b < blocks; b++) {
    const at = b * blockSize;
    alpha.fill(255);
    if (kind === 3) {
      for (let i = 0; i < 16; i++) alpha[i] = ((data[at + (i >> 1)]! >> ((i & 1) * 4)) & 15) * 17;
    } else if (kind === 5) {
      const a0 = data[at]!;
      const a1 = data[at + 1]!;
      const levels = [a0, a1];
      if (a0 > a1) for (let i = 2; i < 8; i++) levels.push(Math.floor(((8 - i) * a0 + (i - 1) * a1) / 7));
      else {
        for (let i = 2; i < 6; i++) levels.push(Math.floor(((6 - i) * a0 + (i - 1) * a1) / 5));
        levels.push(0, 255);
      }
      let bits = 0;
      for (let k = 5; k >= 0; k--) bits = bits * 256 + data[at + 2 + k]!;
      for (let i = 0; i < 16; i++) alpha[i] = levels[Math.floor(bits / 2 ** (3 * i)) & 7]!;
    }
    const c = at + blockSize - 8;
    const v0 = data[c]! | (data[c + 1]! << 8);
    const v1 = data[c + 2]! | (data[c + 3]! << 8);
    const c0 = expand(v0);
    const c1 = expand(v1);
    const colours: [number, number, number, number][] = [[...c0, 255], [...c1, 255]];
    if (kind !== 1 || v0 > v1) {
      colours.push([0, 1, 2].map((k) => Math.floor((2 * c0[k]! + c1[k]!) / 3)).concat(255) as [number, number, number, number]);
      colours.push([0, 1, 2].map((k) => Math.floor((c0[k]! + 2 * c1[k]!) / 3)).concat(255) as [number, number, number, number]);
    } else {
      colours.push([0, 1, 2].map((k) => Math.floor((c0[k]! + c1[k]!) / 2)).concat(255) as [number, number, number, number]);
      colours.push([0, 0, 0, alphaDepth === 0 ? 255 : 0]);
    }
    const bx = (b % across) * 4;
    const by = Math.floor(b / across) * 4;
    for (let y = 0; y < 4; y++) {
      const row = data[c + 4 + y]!;
      for (let x = 0; x < 4; x++) {
        const px = bx + x;
        const py = by + y;
        if (px >= width || py >= height) continue;
        const colour = colours[(row >> (2 * x)) & 3]!;
        const o = (py * width + px) * 4;
        out[o] = colour[0];
        out[o + 1] = colour[1];
        out[o + 2] = colour[2];
        out[o + 3] = kind === 1 ? (alphaDepth === 0 ? 255 : colour[3]) : alpha[y * 4 + x]!;
      }
    }
  }
}

/** Bilinear resize, edges clamped. */
export function scaleRgba(image: RgbaImage, width: number, height: number): RgbaImage {
  const { width: sw, height: sh, rgba: src } = image;
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const v = Math.min(sh - 1, Math.max(0, ((y + 0.5) * sh) / height - 0.5));
    const y0 = Math.floor(v);
    const y1 = Math.min(sh - 1, y0 + 1);
    const fy = v - y0;
    for (let x = 0; x < width; x++) {
      const u = Math.min(sw - 1, Math.max(0, ((x + 0.5) * sw) / width - 0.5));
      const x0 = Math.floor(u);
      const x1 = Math.min(sw - 1, x0 + 1);
      const fx = u - x0;
      for (let k = 0; k < 4; k++) {
        const top = src[(y0 * sw + x0) * 4 + k]! * (1 - fx) + src[(y0 * sw + x1) * 4 + k]! * fx;
        const bottom = src[(y1 * sw + x0) * 4 + k]! * (1 - fx) + src[(y1 * sw + x1) * 4 + k]! * fx;
        out[(y * width + x) * 4 + k] = Math.round(top * (1 - fy) + bottom * fy);
      }
    }
  }
  return { width, height, rgba: out };
}
