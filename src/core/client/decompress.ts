import { inflateSync } from 'node:zlib';
import Bunzip from 'seek-bzip';
import { explode } from './explode';

/**
 * One compressed MPQ sector: a mask byte naming the compressions applied, then the data. The
 * client's map textures and tables use zlib; bzip2 and PKWARE implode are read too. Audio-only
 * compressions (Huffman, ADPCM) and LZMA are not.
 */

export class UnsupportedCompressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedCompressionError';
  }
}

const BZIP2 = 0x10;
const PKWARE = 0x08;
const ZLIB = 0x02;
const LZMA = 0x12;

export function decompressSector(data: Uint8Array, expectedSize: number): Uint8Array {
  const mask = data[0]!;
  if (mask === LZMA || (mask & ~(BZIP2 | PKWARE | ZLIB)) !== 0) {
    throw new UnsupportedCompressionError(`Compression 0x${mask.toString(16).padStart(2, '0')} is not supported.`);
  }
  // Undone in the reverse of the order they were applied: StormLib's order.
  let out: Uint8Array = data.subarray(1);
  if (mask & BZIP2) out = Uint8Array.from(Bunzip.decode(out));
  if (mask & PKWARE) out = explode(out, expectedSize);
  if (mask & ZLIB) out = new Uint8Array(inflateSync(out));
  if (out.length !== expectedSize) throw new Error(`Sector came out at ${out.length} bytes, not its size ${expectedSize}.`);
  return out;
}
