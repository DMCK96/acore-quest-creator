// @ts-nocheck
// From @wowserhq/format 0.28.0 (MIT, Wowser Contributors); see ../../../LICENSE.
import * as io from '@wowserhq/io';
const imvec: any = io.struct({
    r: io.uint8,
    g: io.uint8,
    b: io.uint8,
    a: io.uint8,
});
const mapObjString: any = io.string();
const mver: any = io.struct({
    version: io.uint32le,
});
export { imvec, mapObjString, mver };
