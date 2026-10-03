// @ts-nocheck
// From @wowserhq/format 0.28.0 (MIT, Wowser Contributors); see ../../../LICENSE.
import * as io from '@wowserhq/io';
import { imvec, mver } from './common.js';
const mohd = io.struct({
    textureCount: io.uint32le,
    groupCount: io.uint32le,
    portalCount: io.uint32le,
    lightCount: io.uint32le,
    doodadNameCount: io.uint32le,
    doodadDefCount: io.uint32le,
    doodadSetCount: io.uint32le,
    ambientColor: imvec,
    uniqueId: io.uint32le,
    boundingBox: io.array(io.float32le, { size: 6 }),
    flags: io.uint32le,
});
const momt = io.array(io.struct({
    flags: io.uint32le,
    shader: io.uint32le,
    blend: io.uint32le,
    texture1Offset: io.uint32le,
    sidnColor: imvec,
    frameSidnColor: io.uint32le,
    texture2Offset: io.uint32le,
    diffuseColor: imvec,
    groundType: io.uint32le,
    unk1: io.uint32le,
    unk2: io.uint32le,
    flags2: io.uint32le,
    pad: io.array(io.uint32le, { size: 4 }),
}));
const mogi = io.array(io.struct({
    flags: io.uint32le,
    boundingBox: io.array(io.float32le, { size: 6 }),
    nameOffset: io.int32le,
}));
const mods = io.array(io.struct({
    name: io.string({ size: 20 }),
    startIndex: io.uint32le,
    count: io.uint32le,
    pad: io.uint32le,
}));
const rootChunks = {
    MVER: mver,
    MOHD: mohd,
    MOMT: momt,
    MOGI: mogi,
    MODS: mods,
};
const rootChunk = io.tlv(io.string({ size: 4, reverse: true, terminate: false }), io.uint32le, rootChunks);
const root: any = io.array(rootChunk);
export { root };
