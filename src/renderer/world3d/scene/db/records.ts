// @ts-nocheck
/**
 * The client tables the 3D view reads to draw NPCs and objects, which `@wowserhq/format` 0.25.0 has no
 * records for. Written in the style of that package's records. Each reads exactly the field count the
 * Ascension client's 3.3.5a file has (checked against it): the fields used are named, the rest are
 * skipped as one block so every record lines up. Layouts from https://wowdev.wiki/DB/.
 */
import * as io from '@wowserhq/io';
import { IoMode, openStream } from '@wowserhq/io';
import { ClientDbRecord } from '@wowserhq/format';

// A string field: an offset into the file's string block (a copy of the package's unexported DbStringIo)
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

/** The fields after the named ones, read and dropped */
const rest = (fields: number) => io.typedArray(io.uint32le, { size: fields });

/** CreatureDisplayInfo.dbc: 16 fields */
const creatureDisplayInfoIo = io.struct({
  id: io.int32le,
  modelId: io.int32le,
  soundId: io.int32le,
  extendedDisplayInfoId: io.int32le,
  creatureModelScale: io.float32le,
  creatureModelAlpha: io.int32le,
  // The skins filling the model's replaceable slots 11, 12 and 13, as file names beside the model
  textureVariations: io.array(string, { size: 3 }),
  portraitTextureName: string,
  rest: rest(6),
});

class CreatureDisplayInfoRecord extends ClientDbRecord {
  modelId: number;
  soundId: number;
  extendedDisplayInfoId: number;
  creatureModelScale: number;
  creatureModelAlpha: number;
  textureVariations: string[];
  portraitTextureName: string;

  constructor() {
    super(creatureDisplayInfoIo);
  }
}

/** CreatureModelData.dbc: 28 fields */
const creatureModelDataIo = io.struct({
  id: io.int32le,
  flags: io.int32le,
  modelName: string,
  rest: rest(25),
});

class CreatureModelDataRecord extends ClientDbRecord {
  flags: number;
  modelName: string;

  constructor() {
    super(creatureModelDataIo);
  }
}

/** GameObjectDisplayInfo.dbc: 19 fields */
const gameObjectDisplayInfoIo = io.struct({
  id: io.int32le,
  modelName: string,
  rest: rest(17),
});

class GameObjectDisplayInfoRecord extends ClientDbRecord {
  modelName: string;

  constructor() {
    super(gameObjectDisplayInfoIo);
  }
}

/** The record class each display table is read with, by table name */
const DISPLAY_RECORDS = {
  CreatureDisplayInfo: CreatureDisplayInfoRecord,
  CreatureModelData: CreatureModelDataRecord,
  GameObjectDisplayInfo: GameObjectDisplayInfoRecord,
};

export { CreatureDisplayInfoRecord, CreatureModelDataRecord, DISPLAY_RECORDS, GameObjectDisplayInfoRecord };
