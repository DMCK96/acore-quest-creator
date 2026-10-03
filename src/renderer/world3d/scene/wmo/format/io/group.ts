// @ts-nocheck
// From @wowserhq/format 0.28.0 (MIT, Wowser Contributors); see ../../../LICENSE.
import * as io from '@wowserhq/io';
import { mver } from './common.js';
const mapObjBatch = io.struct({
    boundingBox: io.array(io.int16le, { size: 6 }),
    indexStart: io.uint32le,
    indexCount: io.uint16le,
    firstVertex: io.uint16le,
    lastVertex: io.uint16le,
    flags: io.uint8,
    materialIndex: io.uint8,
});
const mogpChunks = {
    MOBA: io.array(mapObjBatch),
    MOCV: io.typedArray(io.uint8),
    MONR: io.typedArray(io.float32le),
    MOTV: io.typedArray(io.float32le),
    MOVI: io.typedArray(io.uint16le),
    MOVT: io.typedArray(io.float32le),
};
const mogpChunk = io.tlv(io.string({ size: 4, reverse: true, terminate: false }), io.uint32le, mogpChunks);
const mogp = io.struct({
    header: io.struct({
        nameOffset: io.uint32le,
        descriptionOffset: io.uint32le,
        flags: io.uint32le,
        boundingBox: io.array(io.float32le, { size: 6 }),
        portalOffset: io.uint16le,
        portalCount: io.uint16le,
        transBatchCount: io.uint16le,
        intBatchCount: io.uint16le,
        extBatchCount: io.uint16le,
        padding: io.uint16le,
        fogOffsets: io.array(io.uint8, { size: 4 }),
        groupLiquid: io.uint32le,
        uniqueId: io.uint32le,
        flags2: io.uint32le,
        padding2: io.uint32le,
    }),
    data: io.array(mogpChunk),
});
const groupChunks = {
    MVER: mver,
    MOGP: mogp,
};
const groupChunk = io.tlv(io.string({ size: 4, reverse: true, terminate: false }), io.uint32le, groupChunks);
const group: any = io.array(groupChunk);
export { group };
