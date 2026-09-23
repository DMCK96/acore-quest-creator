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
