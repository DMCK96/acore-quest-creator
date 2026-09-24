import { decompressSector } from './decompress';
import { explode } from './explode';
import { decryptBlock, fileKey, hashString, HASH_FILE_KEY, HASH_NAME_A, HASH_NAME_B, HASH_OFFSET } from './mpq-crypto';

/**
 * One MPQ archive (formats 0 and 1, the ones a 3.3.5a client and its patches use): its hash and
 * block tables are read once, files are found by name and read sector by sector. The source is
 * read in pieces, because a client's archives are gigabytes.
 */

export interface ByteSource {
  size: number;
  /** When the file last changed, in ms; 0 or absent when unknown. */
  modified?: number;
  read(offset: number, length: number): Promise<Uint8Array>;
  close?(): Promise<void>;
}

export interface MpqEntry {
  /** Where the file starts in the source, user data included. */
  offset: number;
  compressedSize: number;
  fileSize: number;
  flags: number;
}

export interface MpqArchive {
  name: string;
  /** The file's entry; 'deleted' when this archive (a patch) deletes it; null when it does not have it. */
  find(path: string): MpqEntry | 'deleted' | null;
  read(entry: MpqEntry, path: string): Promise<Uint8Array>;
  close(): Promise<void>;
}

export class MpqFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MpqFormatError';
  }
}

export const MPQ_FILE = {
  IMPLODE: 0x100,
  COMPRESS: 0x200,
  ENCRYPTED: 0x10000,
  FIX_KEY: 0x20000,
  SINGLE_UNIT: 0x01000000,
  DELETE_MARKER: 0x02000000,
  SECTOR_CRC: 0x04000000,
  EXISTS: 0x80000000,
} as const;

const HASH_EMPTY = 0xffffffff;
const HASH_DELETED = 0xfffffffe;
const u32 = (b: Uint8Array, at: number): number => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(at, true);
const u16 = (b: Uint8Array, at: number): number => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint16(at, true);
const magic = (b: Uint8Array): string => String.fromCharCode(b[0]!, b[1]!, b[2]!, b[3]!);

export async function openMpq(source: ByteSource, name: string): Promise<MpqArchive> {
  let base = 0;
  let header = await source.read(0, 44);
  if (header.length >= 16 && magic(header) === 'MPQ\x1b') {
    base = u32(header, 8);
    header = await source.read(base, 44);
  }
  if (header.length < 32 || magic(header) !== 'MPQ\x1a') throw new MpqFormatError(`${name} is not an MPQ archive.`);
  const version = u16(header, 12);
  if (version > 1) throw new MpqFormatError(`${name} is MPQ format ${version}; only 0 and 1 are read.`);
  const sectorSize = 512 << u16(header, 14);
  const hashCount = u32(header, 24);
  const blockCount = u32(header, 28);
  const hiBlockPos = version === 1 ? u32(header, 32) + u32(header, 36) * 2 ** 32 : 0;
  const hashPos = base + u32(header, 16) + (version === 1 ? u16(header, 40) * 2 ** 32 : 0);
  const blockPos = base + u32(header, 20) + (version === 1 ? u16(header, 42) * 2 ** 32 : 0);

  const table = async (pos: number, length: number): Promise<Uint8Array> => {
    if (pos + length > source.size) throw new MpqFormatError(`${name} is cut short: its tables run past its end.`);
    return source.read(pos, length);
  };
  const hashes = decryptBlock(await table(hashPos, hashCount * 16), hashString('(hash table)', HASH_FILE_KEY));
  const blocks = decryptBlock(await table(blockPos, blockCount * 16), hashString('(block table)', HASH_FILE_KEY));
  const hiOffsets = hiBlockPos ? await table(base + hiBlockPos, blockCount * 2) : null;

  const entryOf = (index: number): MpqEntry & { relative: number } => {
    const relative = u32(blocks, index * 16) + (hiOffsets ? u16(hiOffsets, index * 2) * 2 ** 32 : 0);
    return { relative, offset: base + relative, compressedSize: u32(blocks, index * 16 + 4), fileSize: u32(blocks, index * 16 + 8), flags: u32(blocks, index * 16 + 12) };
  };

  function find(path: string): MpqEntry | 'deleted' | null {
    if (hashCount === 0) return null;
    const a = hashString(path, HASH_NAME_A);
    const b = hashString(path, HASH_NAME_B);
    let match: number | null = null;
    for (let i = hashString(path, HASH_OFFSET) % hashCount, n = 0; n < hashCount; i = (i + 1) % hashCount, n++) {
      const block = u32(hashes, i * 16 + 12);
      if (block === HASH_EMPTY) break;
      if (block === HASH_DELETED || block >= blockCount) continue;
      if (u32(hashes, i * 16) !== a || u32(hashes, i * 16 + 4) !== b) continue;
      if (match === null) match = block;
      if (u16(hashes, i * 16 + 8) === 0) {
        match = block;
        break;
      }
    }
    if (match === null) return null;
    const entry = entryOf(match);
    if (entry.flags & MPQ_FILE.DELETE_MARKER) return 'deleted';
    if (!(entry.flags & MPQ_FILE.EXISTS)) return null;
    return entry;
  }

  async function read(entry: MpqEntry, path: string): Promise<Uint8Array> {
    const { flags, fileSize, compressedSize } = entry;
    const relative = entry.offset - base;
    const key = flags & MPQ_FILE.ENCRYPTED ? fileKey(path, relative, fileSize, (flags & MPQ_FILE.FIX_KEY) !== 0) : 0;
    const decrypt = (bytes: Uint8Array, k: number): Uint8Array => (flags & MPQ_FILE.ENCRYPTED ? decryptBlock(bytes, k >>> 0) : bytes);
    const unpack = (bytes: Uint8Array, want: number): Uint8Array => {
      if (bytes.length === want) return bytes;
      if (flags & MPQ_FILE.IMPLODE) return explode(bytes, want);
      if (flags & MPQ_FILE.COMPRESS) return decompressSector(bytes, want);
      return bytes;
    };

    if (flags & MPQ_FILE.SINGLE_UNIT) {
      return unpack(decrypt(await source.read(entry.offset, compressedSize), key), fileSize);
    }
    const sectors = Math.ceil(fileSize / sectorSize);
    const out = new Uint8Array(fileSize);
    if (!(flags & (MPQ_FILE.COMPRESS | MPQ_FILE.IMPLODE))) {
      const raw = await source.read(entry.offset, fileSize);
      for (let i = 0; i < sectors; i++) out.set(decrypt(raw.subarray(i * sectorSize, (i + 1) * sectorSize), key + i), i * sectorSize);
      return out;
    }
    const tableBytes = decrypt(await source.read(entry.offset, (sectors + 1) * 4), key - 1);
    for (let i = 0; i < sectors; i++) {
      const start = u32(tableBytes, i * 4);
      const end = u32(tableBytes, i * 4 + 4);
      const want = Math.min(sectorSize, fileSize - i * sectorSize);
      const sector = decrypt(await source.read(entry.offset + start, end - start), key + i);
      out.set(unpack(sector, want), i * sectorSize);
    }
    return out;
  }

  return { name, find, read, close: async () => source.close?.() };
}
