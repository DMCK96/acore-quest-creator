// From @wowserhq/format 0.28.0 (MIT, Wowser Contributors); see ../LICENSE.
/**
 * Given an array of TLV-like objects, return a Map containing the TLV values indexed by tag.
 * TLV objects with duplicate tags are indexed as arrays.
 */
const indexChunks = (chunks: { tag: string; value: unknown }[]): Map<string, unknown> => {
  const index = new Map<string, unknown>();
  for (const chunk of chunks) {
    const known = index.get(chunk.tag);
    if (!index.has(chunk.tag)) {
      index.set(chunk.tag, chunk.value);
    } else if (Array.isArray(known)) {
      known.push(chunk.value);
    } else {
      index.set(chunk.tag, [known, chunk.value]);
    }
  }
  return index;
};
export { indexChunks };
