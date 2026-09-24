import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decompressSector, UnsupportedCompressionError } from '../../src/core/client/decompress';
import { explode } from '../../src/core/client/explode';

const text = (s: string): Uint8Array => new TextEncoder().encode(s);
const str = (b: Uint8Array): string => new TextDecoder().decode(b);
/** `printf 'hello map hello map' | bzip2 -9`. */
const BZIP2 = Uint8Array.from(Buffer.from('QlpoOTFBWSZTWeLwGjkAAAORgEAAIkbAACAAISgHqEMCFE4vOEokTxdyRThQkOLwGjk=', 'base64'));
/** The test vector from zlib's contrib/blast: these 8 bytes explode to "AIAIAIAIAIAIA". */
const BLAST = Uint8Array.from([0x00, 0x04, 0x82, 0x24, 0x25, 0x8f, 0x80, 0x7f]);

describe('MPQ sector decompression', () => {
  it('inflates zlib sectors (mask 0x02)', () => {
    const plain = text('the painted map of Elwynn Forest '.repeat(20));
    expect(decompressSector(Uint8Array.from([0x02, ...deflateSync(plain)]), plain.length)).toEqual(plain);
  });
  it('unpacks bzip2 sectors (mask 0x10)', () => {
    expect(str(decompressSector(Uint8Array.from([0x10, ...BZIP2]), 19))).toBe('hello map hello map');
  });
  it('explodes PKWARE sectors (mask 0x08)', () => {
    expect(str(decompressSector(Uint8Array.from([0x08, ...BLAST]), 13))).toBe('AIAIAIAIAIAIA');
  });
  it('explodes the blast test vector directly', () => {
    expect(str(explode(BLAST))).toBe('AIAIAIAIAIAIA');
  });
  it('rejects an implode stream with a bad header', () => {
    expect(() => explode(Uint8Array.from([0x02, 0x04, 0x00]))).toThrow(/implode/i);
  });
  it('names a compression it does not read', () => {
    expect(() => decompressSector(Uint8Array.from([0x40, 1, 2, 3]), 10)).toThrow(UnsupportedCompressionError);
    expect(() => decompressSector(Uint8Array.from([0x40, 1, 2, 3]), 10)).toThrow(/0x40/);
  });
  it('fails when a sector does not come out at its size', () => {
    const plain = text('abc'.repeat(40));
    expect(() => decompressSector(Uint8Array.from([0x02, ...deflateSync(plain)]), 99)).toThrow(/size/);
  });
});
