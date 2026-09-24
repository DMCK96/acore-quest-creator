/**
 * The PKWARE Data Compression Library's "implode" format, as older MPQ files use it: a port of
 * Mark Adler's `blast.c` (zlib contrib/blast). The whole output is kept, so a back-reference reads
 * from it directly instead of from a sliding window.
 */

const MAXBITS = 13;

interface Huffman {
  count: Int16Array;
  symbol: Int16Array;
}

/** Code lengths, run-length packed: each byte is (repeat - 1) << 4 | length. */
const LITLEN = [
  11, 124, 8, 7, 28, 7, 188, 13, 76, 4, 10, 8, 12, 10, 12, 10, 8, 23, 8, 9, 7, 6, 7, 8, 7, 6, 55, 8, 23, 24, 12, 11, 7, 9, 11, 12, 6, 7, 22, 5, 7, 24, 6, 11,
  9, 6, 7, 22, 7, 11, 38, 7, 9, 8, 25, 11, 8, 11, 9, 12, 8, 12, 5, 38, 5, 38, 5, 11, 7, 5, 6, 21, 6, 10, 53, 8, 7, 24, 10, 27, 44, 253, 253, 253, 252, 252,
  252, 13, 12, 45, 12, 45, 12, 61, 12, 45, 44, 173,
];
const LENLEN = [2, 35, 36, 53, 38, 23];
const DISTLEN = [2, 20, 53, 230, 247, 151, 248];
const BASE = [3, 2, 4, 5, 6, 7, 8, 9, 10, 12, 16, 24, 40, 72, 136, 264];
const EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8];

function construct(rep: readonly number[]): Huffman {
  const lengths: number[] = [];
  for (const byte of rep) for (let n = (byte >> 4) + 1; n > 0; n--) lengths.push(byte & 15);
  const count = new Int16Array(MAXBITS + 1);
  for (const len of lengths) count[len]! += 1;
  const offs = new Int16Array(MAXBITS + 1);
  for (let len = 1; len < MAXBITS; len++) offs[len + 1] = offs[len]! + count[len]!;
  const symbol = new Int16Array(lengths.length);
  lengths.forEach((len, s) => {
    if (len !== 0) symbol[offs[len]!++] = s;
  });
  return { count, symbol };
}

const LITCODE = construct(LITLEN);
const LENCODE = construct(LENLEN);
const DISTCODE = construct(DISTLEN);

const fail = (why: string): never => {
  throw new Error(`Bad implode stream: ${why}.`);
};

export function explode(data: Uint8Array, expectedSize?: number): Uint8Array {
  let at = 0;
  let bitbuf = 0;
  let bitcnt = 0;
  const bits = (need: number): number => {
    let val = bitbuf;
    while (bitcnt < need) {
      if (at >= data.length) fail('it ends before its end code');
      val |= data[at++]! << bitcnt;
      bitcnt += 8;
    }
    bitbuf = val >>> need;
    bitcnt -= need;
    return val & ((1 << need) - 1);
  };
  // Codes are stored bit-inverted, first bit first.
  const decode = (h: Huffman): number => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len <= MAXBITS; len++) {
      code |= bits(1) ^ 1;
      const count = h.count[len]!;
      if (code < first + count) return h.symbol[index + (code - first)]!;
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    return fail('it has a code that is in no table');
  };

  const lit = bits(8);
  if (lit > 1) fail(`literal mode ${lit}`);
  const dict = bits(8);
  if (dict < 4 || dict > 6) fail(`dictionary size ${dict}`);
  const out: number[] = [];
  const limit = expectedSize ?? Number.POSITIVE_INFINITY;
  while (out.length < limit) {
    if (bits(1)) {
      const lenSym = decode(LENCODE);
      const len = BASE[lenSym]! + bits(EXTRA[lenSym]!);
      if (len === 519) break;
      const shift = len === 2 ? 2 : dict;
      const dist = ((decode(DISTCODE) << shift) + bits(shift)) + 1;
      if (dist > out.length) fail('a distance points before its start');
      for (let i = 0; i < len; i++) out.push(out[out.length - dist]!);
    } else {
      out.push(lit ? decode(LITCODE) : bits(8));
    }
  }
  return Uint8Array.from(expectedSize === undefined ? out : out.slice(0, expectedSize));
}
