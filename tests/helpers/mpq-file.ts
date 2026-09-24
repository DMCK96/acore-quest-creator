import { deflateSync } from 'node:zlib';
import { encryptBlock, fileKey, hashString, HASH_FILE_KEY, HASH_NAME_A, HASH_NAME_B, HASH_OFFSET } from '../../src/core/client/mpq-crypto';
import type { ByteSource } from '../../src/core/client/mpq';

export const FLAG = { IMPLODE: 0x100, COMPRESS: 0x200, ENCRYPTED: 0x10000, FIX_KEY: 0x20000, SINGLE_UNIT: 0x01000000, DELETE_MARKER: 0x02000000, EXISTS: 0x80000000 } as const;

export interface TestFile {
  name: string;
  /** The file's size once read back. */
  size: number;
  /** What is stored for each sector (or the one unit) before encryption, mask byte included where there is one. */
  stored: Uint8Array[];
  flags: number;
  locale?: number;
}

export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export const text = (s: string): Uint8Array => new TextEncoder().encode(s);

/** A file stored whole and uncompressed. */
export const storedFile = (name: string, data: Uint8Array, flags = 0, locale = 0): TestFile =>
  ({ name, size: data.length, stored: [data], flags: flags | FLAG.SINGLE_UNIT, locale });

/** A file in sectors of `sectorSize`, each zlib-compressed behind mask 0x02 unless that would not be smaller. */
export function zlibFile(name: string, data: Uint8Array, sectorSize: number, flags = 0): TestFile {
  const stored: Uint8Array[] = [];
  for (let at = 0; at < data.length; at += sectorSize) {
    const plain = data.subarray(at, at + sectorSize);
    const packed = deflateSync(plain);
    stored.push(packed.length + 1 < plain.length ? Uint8Array.from([0x02, ...packed]) : Uint8Array.from(plain));
  }
  return { name, size: data.length, stored, flags: flags | FLAG.COMPRESS };
}

export const deleteMarker = (name: string): TestFile => ({ name, size: 0, stored: [], flags: FLAG.DELETE_MARKER });

/** An MPQ (format 0 or 1) holding the files, optionally behind a user-data block. */
export function buildMpq(files: TestFile[], opts: { version?: 0 | 1; sectorShift?: number; userDataShift?: number } = {}): Uint8Array {
  const version = opts.version ?? 0;
  const headerSize = version === 1 ? 44 : 32;
  const chunks: Uint8Array[] = [];
  const blocks: [number, number, number, number][] = [];
  let at = headerSize;
  for (const f of files) {
    const offset = at;
    const key = f.flags & FLAG.ENCRYPTED ? fileKey(f.name, offset, f.size, (f.flags & FLAG.FIX_KEY) !== 0) : 0;
    const sectored = !(f.flags & FLAG.SINGLE_UNIT) && (f.flags & (FLAG.COMPRESS | FLAG.IMPLODE)) !== 0;
    let body: Uint8Array;
    if (sectored) {
      const table = new Uint8Array((f.stored.length + 1) * 4);
      const tv = new DataView(table.buffer);
      let pos = table.length;
      f.stored.forEach((s, i) => {
        tv.setUint32(i * 4, pos, true);
        pos += s.length;
      });
      tv.setUint32(f.stored.length * 4, pos, true);
      const sectors = f.stored.map((s, i) => (key ? encryptBlock(s, (key + i) >>> 0) : s));
      body = concat([key ? encryptBlock(table, (key - 1) >>> 0) : table, ...sectors]);
    } else {
      const whole = concat(f.stored);
      body = key ? encryptBlock(whole, key) : whole;
    }
    chunks.push(body);
    blocks.push([offset, body.length, f.size, (f.flags | FLAG.EXISTS) >>> 0]);
    at += body.length;
  }
  let hashCount = 16;
  while (hashCount < files.length * 2) hashCount *= 2;
  const hash = new Uint8Array(hashCount * 16).fill(0xff);
  const hv = new DataView(hash.buffer);
  files.forEach((f, i) => {
    let slot = hashString(f.name, HASH_OFFSET) % hashCount;
    while (hv.getUint32(slot * 16 + 12, true) !== 0xffffffff) slot = (slot + 1) % hashCount;
    hv.setUint32(slot * 16, hashString(f.name, HASH_NAME_A), true);
    hv.setUint32(slot * 16 + 4, hashString(f.name, HASH_NAME_B), true);
    hv.setUint16(slot * 16 + 8, f.locale ?? 0, true);
    hv.setUint16(slot * 16 + 10, 0, true);
    hv.setUint32(slot * 16 + 12, i, true);
  });
  const block = new Uint8Array(blocks.length * 16);
  const bv = new DataView(block.buffer);
  blocks.forEach((b, i) => b.forEach((v, k) => bv.setUint32(i * 16 + k * 4, v, true)));
  const hashPos = at;
  const blockPos = hashPos + hash.length;
  const header = new Uint8Array(headerSize);
  const h = new DataView(header.buffer);
  header.set([0x4d, 0x50, 0x51, 0x1a]);
  h.setUint32(4, headerSize, true);
  h.setUint32(8, blockPos + block.length, true);
  h.setUint16(12, version, true);
  h.setUint16(14, opts.sectorShift ?? 3, true);
  h.setUint32(16, hashPos, true);
  h.setUint32(20, blockPos, true);
  h.setUint32(24, hashCount, true);
  h.setUint32(28, blocks.length, true);
  const archive = concat([
    header,
    ...chunks,
    encryptBlock(hash, hashString('(hash table)', HASH_FILE_KEY)),
    encryptBlock(block, hashString('(block table)', HASH_FILE_KEY)),
  ]);
  const shift = opts.userDataShift ?? 0;
  if (!shift) return archive;
  const user = new Uint8Array(shift);
  const uv = new DataView(user.buffer);
  user.set([0x4d, 0x50, 0x51, 0x1b]);
  uv.setUint32(4, shift - 16, true);
  uv.setUint32(8, shift, true);
  uv.setUint32(12, 16, true);
  return concat([user, archive]);
}

export const bytesSource = (bytes: Uint8Array): ByteSource => ({
  size: bytes.length,
  read: async (offset, length) => bytes.slice(offset, offset + length),
});
