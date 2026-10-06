// From @wowserhq/format 0.28.0 (MIT, Wowser Contributors); see ../../../LICENSE.
import * as io from '@wowserhq/io';
import * as num from './numeric.js';
import { imvec, mver } from './common.js';
const mohd = io.struct({
    textureCount: num.uint32le,
    groupCount: num.uint32le,
    portalCount: num.uint32le,
    lightCount: num.uint32le,
    doodadNameCount: num.uint32le,
    doodadDefCount: num.uint32le,
    doodadSetCount: num.uint32le,
    ambientColor: imvec,
    uniqueId: num.uint32le,
    boundingBox: io.array(num.float32le, { size: 6 }),
    flags: num.uint32le,
});
const momt = io.array(io.struct({
    flags: num.uint32le,
    shader: num.uint32le,
    blend: num.uint32le,
    texture1Offset: num.uint32le,
    sidnColor: imvec,
    frameSidnColor: num.uint32le,
    texture2Offset: num.uint32le,
    diffuseColor: imvec,
    groundType: num.uint32le,
    unk1: num.uint32le,
    unk2: num.uint32le,
    flags2: num.uint32le,
    pad: io.array(num.uint32le, { size: 4 }),
}));
const mogi = io.array(io.struct({
    flags: num.uint32le,
    boundingBox: io.array(num.float32le, { size: 6 }),
    nameOffset: num.int32le,
}));
const mods = io.array(io.struct({
    name: io.string({ size: 20 }),
    startIndex: num.uint32le,
    count: num.uint32le,
    pad: num.uint32le,
}));
// Added here: the building's doodads (MODD), each named by an offset into MODN in its low 24 bits
const modd = io.array(io.struct({
    nameIndex: num.uint32le,
    position: io.array(num.float32le, { size: 3 }),
    rotation: io.array(num.float32le, { size: 4 }),
    scale: num.float32le,
    color: imvec,
}));
const rootChunks = {
    MVER: mver,
    MOHD: mohd,
    MOMT: momt,
    MOGI: mogi,
    MODS: mods,
    MODD: modd,
};
const rootChunk = io.tlv(io.string({ size: 4, reverse: true, terminate: false }), num.uint32le, rootChunks);
const root: any = io.array(rootChunk);
export { root };
