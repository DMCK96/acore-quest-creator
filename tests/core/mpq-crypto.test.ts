import { describe, expect, it } from 'vitest';
import { decryptBlock, encryptBlock, fileKey, hashString, HASH_FILE_KEY, HASH_NAME_A, HASH_NAME_B, HASH_OFFSET } from '../../src/core/client/mpq-crypto';

describe('MPQ hashing and encryption', () => {
  it('hashes the table keys to the values every MPQ uses', () => {
    expect(hashString('(hash table)', HASH_FILE_KEY)).toBe(0xc3af3770);
    expect(hashString('(block table)', HASH_FILE_KEY)).toBe(0xec83b3a3);
  });
  it('ignores letter case and treats / as \\', () => {
    for (const type of [HASH_OFFSET, HASH_NAME_A, HASH_NAME_B]) {
      expect(hashString('Textures/Minimap/md5translate.trs', type)).toBe(hashString('TEXTURES\\MINIMAP\\MD5TRANSLATE.TRS', type));
    }
  });
  it('decrypts as the client does', () => {
    expect(Array.from(decryptBlock(new Uint8Array(8), 0xc3af3770))).toEqual([0xcc, 0xcf, 0x3c, 0x86, 0xa4, 0xf6, 0x09, 0xee]);
  });
  it('decrypts what it encrypts, leaving a trailing partial word as it is', () => {
    const plain = Uint8Array.from({ length: 23 }, (_, i) => (i * 7) & 0xff);
    const sealed = encryptBlock(plain, 0x12345678);
    expect(sealed).not.toEqual(plain);
    expect(sealed.slice(20)).toEqual(plain.slice(20));
    expect(decryptBlock(sealed, 0x12345678)).toEqual(plain);
  });
  it('derives a file key from the file name only, adjusted by offset and size when asked', () => {
    const base = hashString('Elwynn1.blp', HASH_FILE_KEY);
    expect(fileKey('Interface\\WorldMap\\Elwynn\\Elwynn1.blp', 100, 50, false)).toBe(base);
    expect(fileKey('Interface/WorldMap/Elwynn/Elwynn1.blp', 100, 50, true)).toBe((((base + 100) >>> 0) ^ 50) >>> 0);
  });
});
