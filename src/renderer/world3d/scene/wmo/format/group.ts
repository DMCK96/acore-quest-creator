// @ts-nocheck
/**
 * A building's group file (`name_000.wmo`): the geometry of one part. Read here, by hand, and not by
 * the parser package's reader, which builds typed arrays straight from the sizes a file states (so
 * a chunk that is not a whole number of floats throws) and finds where the lit vertices begin by
 * indexing the batch list one place too far (so a group whose batches are all see-through throws).
 * Real files do both; what cannot be used is skipped, and the rest is kept.
 */

const FLAG_CVERTS_FIXED = 0x8;
const MOGP_HEADER_SIZE = 68;

type WmoGroupBatch = {
  indexStart: number;
  indexCount: number;
  firstVertex: number;
  lastVertex: number;
  materialIndex: number;
};

type WmoGroupData = {
  vertices: Float32Array | null;
  normals: Float32Array | null;
  textureCoords: Float32Array | null;
  /** Baked lighting, blue-green-red-alpha, lit as the game lights it */
  colors: Uint8Array | null;
  indices: Uint16Array | null;
  batches: WmoGroupBatch[];
};

type Chunk = { tag: string; start: number; size: number };

/** The chunks in a run of bytes: tag (stored backwards), size, data. A size running past the end is cut to it. */
const readChunks = (view: DataView, from: number, to: number): Chunk[] => {
  const chunks: Chunk[] = [];
  let at = from;
  while (at + 8 <= to) {
    let tag = '';
    for (let i = 3; i >= 0; i--) {
      tag += String.fromCharCode(view.getUint8(at + i));
    }
    const size = Math.min(view.getUint32(at + 4, true), to - (at + 8));
    chunks.push({ tag, start: at + 8, size });
    at += 8 + size;
  }
  return chunks;
};

/** Copies a chunk's bytes into a typed array of whole elements; a trailing part of one is dropped. */
const copyArray = <T extends Float32Array | Uint16Array | Uint8Array>(
  buffer: ArrayBuffer,
  chunk: Chunk,
  Type: { new (buffer: ArrayBuffer): T; BYTES_PER_ELEMENT: number },
): T => {
  const whole = chunk.size - (chunk.size % Type.BYTES_PER_ELEMENT);
  return new Type(buffer.slice(chunk.start, chunk.start + whole));
};

const parseGroup = (buffer: ArrayBuffer, rootFlags: number): WmoGroupData => {
  const view = new DataView(buffer);
  const top = readChunks(view, 0, buffer.byteLength);
  const mogp = top.find((chunk) => chunk.tag === 'MOGP');

  if (!mogp || mogp.size < MOGP_HEADER_SIZE) {
    const found = top.map((chunk) => `${chunk.tag}:${chunk.size}`).join(' ');
    throw new Error(`no group data (the file's chunks are ${found || 'none'})`);
  }

  const transBatchCount = view.getUint16(mogp.start + 40, true);
  const subchunks = readChunks(view, mogp.start + MOGP_HEADER_SIZE, mogp.start + mogp.size);
  const first = (tag: string) => subchunks.find((chunk) => chunk.tag === tag);

  const batches: WmoGroupBatch[] = [];
  const batchChunk = first('MOBA');
  if (batchChunk) {
    for (let at = batchChunk.start; at + 24 <= batchChunk.start + batchChunk.size; at += 24) {
      batches.push({
        indexStart: view.getUint32(at + 12, true),
        indexCount: view.getUint16(at + 16, true),
        firstVertex: view.getUint16(at + 18, true),
        lastVertex: view.getUint16(at + 20, true),
        materialIndex: view.getUint8(at + 23),
      });
    }
  }

  const verticesChunk = first('MOVT');
  const indicesChunk = first('MOVI');
  const normalsChunk = first('MONR');
  const uvChunk = first('MOTV');
  const colorChunk = first('MOCV');

  let colors: Uint8Array | null = colorChunk ? copyArray(buffer, colorChunk, Uint8Array) : null;
  if (colors && !(rootFlags & FLAG_CVERTS_FIXED)) {
    // The lit (interior and exterior) vertices come after the see-through ones, which are lit differently
    const lastTransBatch = transBatchCount > 0 ? batches[Math.min(transBatchCount, batches.length) - 1] : undefined;
    const litStart = lastTransBatch ? lastTransBatch.lastVertex + 1 : 0;

    for (let i = 0; i + 3 < colors.length; i += 4) {
      let b = colors[i];
      let g = colors[i + 1];
      let r = colors[i + 2];
      const a = colors[i + 3];

      if (i / 4 >= litStart) {
        r = Math.min(((r + ((r * a) / 64)) / 2) | 0, 255);
        g = Math.min(((g + ((g * a) / 64)) / 2) | 0, 255);
        b = Math.min(((b + ((b * a) / 64)) / 2) | 0, 255);
        colors[i + 3] = 255;
      } else {
        r = (r / 2) | 0;
        g = (g / 2) | 0;
        b = (b / 2) | 0;
      }

      colors[i] = b;
      colors[i + 1] = g;
      colors[i + 2] = r;
    }
  }

  return {
    vertices: verticesChunk ? copyArray(buffer, verticesChunk, Float32Array) : null,
    normals: normalsChunk ? copyArray(buffer, normalsChunk, Float32Array) : null,
    textureCoords: uvChunk ? copyArray(buffer, uvChunk, Float32Array) : null,
    colors,
    indices: indicesChunk ? copyArray(buffer, indicesChunk, Uint16Array) : null,
    batches,
  };
};

export { parseGroup };
export type { WmoGroupBatch, WmoGroupData };
