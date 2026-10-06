import * as io from '@wowserhq/io';

/**
 * The library's number types, as the `IoType` its own structs and arrays take. @wowserhq/io 2.0.2
 * declares a number's `read` as taking an `IoStream` but `IoType`'s as taking an `IoSource`, so under
 * strict function types its numbers do not fit its own structs; they read the same either way.
 */
const typed = (type: unknown): io.IoType => type as io.IoType;

export const uint8 = typed(io.uint8);
export const int32le = typed(io.int32le);
export const uint32le = typed(io.uint32le);
export const float32le = typed(io.float32le);
