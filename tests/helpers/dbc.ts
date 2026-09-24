/** Builds a WDBC file of uint32 fields, with an empty string block (one NUL, as the client's files have). */
export function buildDbc(records: number[][], fieldCount = records[0]?.length ?? 0): Uint8Array {
  const recordSize = fieldCount * 4;
  const bytes = new Uint8Array(20 + records.length * recordSize + 1);
  const view = new DataView(bytes.buffer);
  bytes.set([0x57, 0x44, 0x42, 0x43]); // WDBC
  view.setUint32(4, records.length, true);
  view.setUint32(8, fieldCount, true);
  view.setUint32(12, recordSize, true);
  view.setUint32(16, 1, true);
  records.forEach((r, i) => r.forEach((v, f) => view.setUint32(20 + i * recordSize + f * 4, v, true)));
  return bytes;
}

/** A QuestXP.dbc whose level `L` pays `L * 100 * n` for tier `n`. */
export function questXpDbc(levels: number[]): Uint8Array {
  return buildDbc(levels.map((level) => [level, ...Array.from({ length: 10 }, (_, n) => level * 100 * n)]));
}

/** A float's bits as the uint32 a DBC field stores. */
export function f32(x: number): number {
  const v = new DataView(new ArrayBuffer(4));
  v.setFloat32(0, x, true);
  return v.getUint32(0, true);
}

/** A WDBC file whose string cells are written to a real string block; numbers are written as uint32. */
export function buildDbcWithStrings(records: (number | string)[][], fieldCount: number): Uint8Array {
  const strings: number[] = [0];
  const offsets = new Map<string, number>([['', 0]]);
  const enc = new TextEncoder();
  const offsetOf = (s: string): number => {
    const known = offsets.get(s);
    if (known !== undefined) return known;
    const at = strings.length;
    strings.push(...enc.encode(s), 0);
    offsets.set(s, at);
    return at;
  };
  const numeric = records.map((r) => Array.from({ length: fieldCount }, (_, f) => (typeof r[f] === 'string' ? offsetOf(r[f] as string) : ((r[f] as number | undefined) ?? 0))));
  const recordSize = fieldCount * 4;
  const bytes = new Uint8Array(20 + numeric.length * recordSize + strings.length);
  const view = new DataView(bytes.buffer);
  bytes.set([0x57, 0x44, 0x42, 0x43]);
  view.setUint32(4, numeric.length, true);
  view.setUint32(8, fieldCount, true);
  view.setUint32(12, recordSize, true);
  view.setUint32(16, strings.length, true);
  numeric.forEach((r, i) => r.forEach((v, f) => view.setUint32(20 + i * recordSize + f * 4, v >>> 0, true)));
  bytes.set(strings, 20 + numeric.length * recordSize);
  return bytes;
}
