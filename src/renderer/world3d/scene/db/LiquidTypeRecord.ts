// @ts-nocheck
/**
 * LiquidType.dbc (3.3.5a, 45 fields), which `@wowserhq/format` 0.25.0 has no record for. Written in
 * the style of that package's records. Layout from https://wowdev.wiki/DB/LiquidType, checked against
 * the Ascension client's file (26 records of 180 bytes).
 */
import * as io from '@wowserhq/io';
import { IoMode, openStream } from '@wowserhq/io';
import { ClientDbRecord } from '@wowserhq/format';

// A string field: an offset into the file's string block. The package's own reader (DbStringIo,
// MIT, by the Wowser contributors) is not exported, so this is a copy of it
const blockString = io.string({ terminate: true });
const string = {
  getSize: () => io.uint32le.getSize(undefined),
  read(source, context = {}) {
    const stream = openStream(source, IoMode.Read);
    const stringBlock = context.stringBlock;
    stringBlock.offset = io.uint32le.read(stream);
    return blockString.read(stringBlock);
  },
};

const recordIo = io.struct({
  id: io.int32le,
  name: string,
  flags: io.int32le,
  // 0 water, 1 ocean, 2 magma, 3 slime: decides the tint and whether it is lit (also the sound bank)
  soundBank: io.int32le,
  soundId: io.int32le,
  spellId: io.int32le,
  maxDarkenDepth: io.float32le,
  fogDarkenIntensity: io.float32le,
  ambDarkenIntensity: io.float32le,
  dirDarkenIntensity: io.float32le,
  lightId: io.int32le,
  particleScale: io.float32le,
  particleMovement: io.int32le,
  particleTexSlots: io.int32le,
  materialId: io.int32le,
  // The first is the surface flipbook, with %d for the frame (from 1)
  textures: io.array(string, { size: 6 }),
  colors: io.array(io.uint32le, { size: 2 }),
  floats: io.array(io.float32le, { size: 18 }),
  ints: io.array(io.int32le, { size: 4 }),
});

class LiquidTypeRecord extends ClientDbRecord {
  name: string;
  flags: number;
  soundBank: number;
  soundId: number;
  spellId: number;
  maxDarkenDepth: number;
  fogDarkenIntensity: number;
  ambDarkenIntensity: number;
  dirDarkenIntensity: number;
  lightId: number;
  particleScale: number;
  particleMovement: number;
  particleTexSlots: number;
  materialId: number;
  textures: string[];
  colors: number[];
  floats: number[];
  ints: number[];

  constructor() {
    super(recordIo);
  }
}

export default LiquidTypeRecord;
export { LiquidTypeRecord };
