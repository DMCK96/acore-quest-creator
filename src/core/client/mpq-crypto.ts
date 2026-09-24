/**
 * The hashing and encryption every MPQ archive uses: names are found by three hashes of the
 * upper-cased path, and the hash table, block table and some files are encrypted with a key that
 * is itself a hash. The table and the steps are StormLib's, which the client's own code matches.
 */

export const HASH_OFFSET = 0;
export const HASH_NAME_A = 1;
export const HASH_NAME_B = 2;
export const HASH_FILE_KEY = 3;

const CRYPT_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(0x500);
  let seed = 0x00100001;
  for (let index1 = 0; index1 < 0x100; index1++) {
    for (let i = 0, index2 = index1; i < 5; i++, index2 += 0x100) {
      seed = (seed * 125 + 3) % 0x2aaaab;
      const hi = (seed & 0xffff) << 16;
      seed = (seed * 125 + 3) % 0x2aaaab;
      table[index2] = (hi | (seed & 0xffff)) >>> 0;
    }
  }
  return table;
})();

/** One of the four hashes of a path; letter case and the kind of slash do not matter. */
export function hashString(name: string, type: number): number {
  let s1 = 0x7fed7fed;
  let s2 = 0xeeeeeeee;
  for (let i = 0; i < name.length; i++) {
    let c = name.charCodeAt(i);
    if (c >= 0x61 && c <= 0x7a) c -= 0x20;
    else if (c === 0x2f) c = 0x5c;
    s1 = (CRYPT_TABLE[type * 256 + (c & 0xff)]! ^ ((s1 + s2) >>> 0)) >>> 0;
    s2 = (c + s1 + s2 + ((s2 << 5) >>> 0) + 3) >>> 0;
  }
  return s1;
}

function crypt(data: Uint8Array, key: number, encrypt: boolean): Uint8Array {
  const out = Uint8Array.from(data);
  const view = new DataView(out.buffer);
  let k = key >>> 0;
  let s2 = 0xeeeeeeee;
  for (let at = 0; at + 4 <= out.length; at += 4) {
    s2 = (s2 + CRYPT_TABLE[0x400 + (k & 0xff)]!) >>> 0;
    const input = view.getUint32(at, true);
    const output = (input ^ ((k + s2) >>> 0)) >>> 0;
    view.setUint32(at, output, true);
    const plain = encrypt ? input : output;
    k = ((((~k << 21) >>> 0) + 0x11111111) | (k >>> 11)) >>> 0;
    s2 = (plain + s2 + ((s2 << 5) >>> 0) + 3) >>> 0;
  }
  return out;
}

/** Encrypts whole 32-bit words; a trailing partial word is left as it is, as the client does. */
export const encryptBlock = (data: Uint8Array, key: number): Uint8Array => crypt(data, key, true);
export const decryptBlock = (data: Uint8Array, key: number): Uint8Array => crypt(data, key, false);

/** The key of an encrypted file: its name's hash, adjusted by where it is and its size when the archive asks. */
export function fileKey(path: string, blockOffset: number, fileSize: number, fixKey: boolean): number {
  const name = path.slice(Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')) + 1);
  const key = hashString(name, HASH_FILE_KEY);
  return fixKey ? (((key + blockOffset) >>> 0) ^ fileSize) >>> 0 : key;
}
