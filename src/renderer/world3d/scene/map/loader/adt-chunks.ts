/**
 * Chunks of a map area file (ADT) that @wowserhq/format does not read, or reads and drops, found
 * through the area's header (MHDR) as the game finds them.
 */

/** Where MHDR keeps each chunk's offset, counted from the start of MHDR's data */
const MHDR_FIELDS = { modf: 32, mh2o: 40 } as const;

/** MVER (12 bytes), then MHDR's tag and size (8): where MHDR's data, and its offsets, start */
const MHDR_DATA = 20;
const MHDR_SIZE = 64;

/** A chunk's data as offsets into the area file; null when the area has none */
const findAdtChunk = (view: DataView, chunk: keyof typeof MHDR_FIELDS): { dataStart: number; dataEnd: number } | null => {
  if (view.byteLength < MHDR_DATA + MHDR_SIZE) {
    return null;
  }

  const offset = view.getUint32(MHDR_DATA + MHDR_FIELDS[chunk], true);
  if (offset === 0) {
    return null;
  }

  const chunkStart = MHDR_DATA + offset;
  if (chunkStart + 8 > view.byteLength) {
    return null;
  }

  const size = view.getUint32(chunkStart + 4, true);
  const dataStart = chunkStart + 8;
  return { dataStart, dataEnd: Math.min(dataStart + size, view.byteLength) };
};

/** A building placement (MODF entry): 64 bytes, its doodad set at byte 58 */
const MODF_ENTRY = 64;
const MODF_DOODAD_SET = 58;

/**
 * Each building placement's doodad set, in file order (the order @wowserhq/format lists them in): the
 * set of furniture and props the placement shows beside the building's default set
 */
const readObjDefDoodadSets = (areaData: ArrayBuffer): number[] => {
  const view = new DataView(areaData);
  const modf = findAdtChunk(view, 'modf');
  if (!modf) {
    return [];
  }

  const sets: number[] = [];
  for (let at = modf.dataStart; at + MODF_ENTRY <= modf.dataEnd; at += MODF_ENTRY) {
    sets.push(view.getUint16(at + MODF_DOODAD_SET, true));
  }
  return sets;
};

export { findAdtChunk, readObjDefDoodadSets };
