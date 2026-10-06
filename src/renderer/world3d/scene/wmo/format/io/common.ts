// From @wowserhq/format 0.28.0 (MIT, Wowser Contributors); see ../../../LICENSE.
import * as io from '@wowserhq/io';
import * as num from './numeric.js';
const imvec: any = io.struct({
    r: num.uint8,
    g: num.uint8,
    b: num.uint8,
    a: num.uint8,
});
const mapObjString: any = io.string();
const mver: any = io.struct({
    version: num.uint32le,
});
export { imvec, mapObjString, mver };
