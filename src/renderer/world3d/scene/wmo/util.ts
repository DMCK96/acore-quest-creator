// @ts-nocheck
// From @wowserhq/format 0.28.0 (MIT, Wowser Contributors); see ../LICENSE.
/**
 * Given an array of TLV-like objects, return a Map containing the TLV values indexed by tag.
 * TLV objects with duplicate tags are indexed as arrays.
 *
 * @param chunks
 */
const indexChunks = (chunks) => {
    const index = new Map();
    for (const chunk of chunks) {
        if (!index.has(chunk.tag)) {
            index.set(chunk.tag, chunk.value);
        }
        else if (Array.isArray(index.get(chunk.tag))) {
            index.get(chunk.tag).push(chunk.value);
        }
        else {
            const chunks = [index.get(chunk.tag)];
            chunks.push(chunk.value);
            index.set(chunk.tag, chunks);
        }
    }
    return index;
};
export { indexChunks };
