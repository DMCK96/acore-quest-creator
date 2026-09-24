/**
 * Reads the server's client-data files (`<DataDir>/dbc/*.dbc`, the WDBC format of 3.3.5a). The
 * server loads these at start-up and trusts its own copy, so they are the source of truth for the
 * tables the world database only overrides (`questxp_dbc` and the other `*_dbc` tables).
 *
 * Layout: a 20-byte header (`WDBC`, record count, field count, record size, string block size, all
 * little-endian uint32), the fixed-size records, then the string block.
 */

export class DbcFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbcFormatError';
  }
}

const HEADER_SIZE = 20;
const FIELD_SIZE = 4;

export interface DbcTable {
  fieldCount: number;
  /** One uint32 per field per record; string and float fields come back as their raw bits. */
  records: number[][];
}

export function parseDbc(bytes: Uint8Array, name = 'file'): DbcTable {
  if (bytes.length < HEADER_SIZE) throw new DbcFormatError(`${name} is too short to be a DBC file.`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  if (magic !== 'WDBC') throw new DbcFormatError(`${name} is not a WDBC file (it starts with "${magic}").`);
  const recordCount = view.getUint32(4, true);
  const fieldCount = view.getUint32(8, true);
  const recordSize = view.getUint32(12, true);
  const stringBlockSize = view.getUint32(16, true);
  if (recordSize < fieldCount * FIELD_SIZE) {
    throw new DbcFormatError(`${name} has ${fieldCount} fields but only ${recordSize} bytes per record.`);
  }
  if (HEADER_SIZE + recordCount * recordSize + stringBlockSize !== bytes.length) {
    throw new DbcFormatError(`${name} is ${bytes.length} bytes, which does not match its header.`);
  }

  const records: number[][] = [];
  for (let r = 0; r < recordCount; r++) {
    const start = HEADER_SIZE + r * recordSize;
    const record: number[] = [];
    for (let f = 0; f < fieldCount; f++) record.push(view.getUint32(start + f * FIELD_SIZE, true));
    records.push(record);
  }
  return { fieldCount, records };
}

export const QUEST_XP_FILE = 'QuestXP.dbc';
/** `QuestXPEntry` in the server: the level, then `Exp[10]`, one per `RewardXPDifficulty`. */
const QUEST_XP_TIERS = 10;

/** QuestXP.dbc by level: entry `n` of each array is the XP `RewardXPDifficulty = n` pays. */
export function parseQuestXp(bytes: Uint8Array): Map<number, number[]> {
  const table = parseDbc(bytes, QUEST_XP_FILE);
  if (table.fieldCount < 1 + QUEST_XP_TIERS) {
    throw new DbcFormatError(`${QUEST_XP_FILE} has ${table.fieldCount} fields; a 3.3.5a file has ${1 + QUEST_XP_TIERS}.`);
  }
  return new Map(table.records.map((r) => [r[0]!, r.slice(1, 1 + QUEST_XP_TIERS)]));
}

/** The string a string field points at: its value is an offset into the block after the records. */
export function dbcString(bytes: Uint8Array, offset: number): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = HEADER_SIZE + view.getUint32(4, true) * view.getUint32(12, true) + offset;
  let end = start;
  while (end < bytes.length && bytes[end] !== 0) end += 1;
  return new TextDecoder().decode(bytes.subarray(start, end));
}

/** A float field's value from the raw bits `parseDbc` returns. */
export function dbcFloat(bits: number): number {
  const view = new DataView(new ArrayBuffer(4));
  view.setUint32(0, bits, true);
  return view.getFloat32(0, true);
}
