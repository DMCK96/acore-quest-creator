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

/** CreatureDisplayInfoExtra.dbc: 21 fields; how a humanoid NPC is built from its race's body */
const creatureDisplayInfoExtraIo = io.struct({
  id: io.int32le,
  race: io.int32le,
  sex: io.int32le,
  skin: io.int32le,
  face: io.int32le,
  hairStyle: io.int32le,
  hairColour: io.int32le,
  facialHair: io.int32le,
  itemDisplays: io.array(io.int32le, { size: 11 }),
  flags: io.int32le,
  // Its skin, face and clothes in one texture, under Textures\BakedNpcTextures
  bakeName: string,
});

class CreatureDisplayInfoExtraRecord extends ClientDbRecord {
  race: number;
  sex: number;
  skin: number;
  face: number;
  hairStyle: number;
  hairColour: number;
  facialHair: number;
  itemDisplays: number[];
  flags: number;
  bakeName: string;

  constructor() {
    super(creatureDisplayInfoExtraIo);
  }
}

/** ChrRaces.dbc: 69 fields; only the body displays are read */
const chrRacesIo = io.struct({
  id: io.int32le,
  flags: io.int32le,
  factionId: io.int32le,
  explorationSoundId: io.int32le,
  maleDisplayId: io.int32le,
  femaleDisplayId: io.int32le,
  rest: rest(63),
});

class ChrRacesRecord extends ClientDbRecord {
  flags: number;
  factionId: number;
  explorationSoundId: number;
  maleDisplayId: number;
  femaleDisplayId: number;

  constructor() {
    super(chrRacesIo);
  }
}

/** CharHairGeosets.dbc: 6 fields; which geoset a hairstyle shows */
const charHairGeosetsIo = io.struct({
  id: io.int32le,
  race: io.int32le,
  sex: io.int32le,
  variation: io.int32le,
  geoset: io.int32le,
  showScalp: io.int32le,
});

class CharHairGeosetsRecord extends ClientDbRecord {
  race: number;
  sex: number;
  variation: number;
  geoset: number;
  showScalp: number;

  constructor() {
    super(charHairGeosetsIo);
  }
}

/** CharSections.dbc: 10 fields; base section 3 is hair */
const charSectionsIo = io.struct({
  id: io.int32le,
  race: io.int32le,
  sex: io.int32le,
  baseSection: io.int32le,
  textures: io.array(string, { size: 3 }),
  flags: io.int32le,
  variation: io.int32le,
  colour: io.int32le,
});

class CharSectionsRecord extends ClientDbRecord {
  race: number;
  sex: number;
  baseSection: number;
  textures: string[];
  flags: number;
  variation: number;
  colour: number;

  constructor() {
    super(charSectionsIo);
  }
}

/** CharacterFacialHairStyles.dbc: 8 fields and no id (read it through `records`) */
const characterFacialHairStylesIo = io.struct({
  race: io.int32le,
  sex: io.int32le,
  variation: io.int32le,
  // Geoset values for groups 1, 2 and 3 (then two unused)
  geosets: io.array(io.int32le, { size: 5 }),
});

class CharacterFacialHairStylesRecord extends ClientDbRecord {
  race: number;
  sex: number;
  variation: number;
  geosets: number[];

  constructor() {
    super(characterFacialHairStylesIo);
  }
}

/** Item.dbc: 8 fields; the display an item is drawn with */
const itemIo = io.struct({
  id: io.int32le,
  classId: io.int32le,
  subclassId: io.int32le,
  soundOverride: io.int32le,
  material: io.int32le,
  displayInfoId: io.int32le,
  inventoryType: io.int32le,
  sheatheType: io.int32le,
});

class ItemRecord extends ClientDbRecord {
  classId: number;
  subclassId: number;
  soundOverride: number;
  material: number;
  displayInfoId: number;
  inventoryType: number;
  sheatheType: number;

  constructor() {
    super(itemIo);
  }
}

/** ItemDisplayInfo.dbc: 25 fields; an item's model files and their textures (left and right) */
const itemDisplayInfoIo = io.struct({
  id: io.int32le,
  modelNames: io.array(string, { size: 2 }),
  modelTextures: io.array(string, { size: 2 }),
  rest: rest(20),
});

class ItemDisplayInfoRecord extends ClientDbRecord {
  modelNames: string[];
  modelTextures: string[];

  constructor() {
    super(itemDisplayInfoIo);
  }
}

/** The record class each display table is read with, by table name */
const DISPLAY_RECORDS = {
  CreatureDisplayInfo: CreatureDisplayInfoRecord,
  CreatureModelData: CreatureModelDataRecord,
  GameObjectDisplayInfo: GameObjectDisplayInfoRecord,
  CreatureDisplayInfoExtra: CreatureDisplayInfoExtraRecord,
  ChrRaces: ChrRacesRecord,
  CharHairGeosets: CharHairGeosetsRecord,
  CharSections: CharSectionsRecord,
  CharacterFacialHairStyles: CharacterFacialHairStylesRecord,
  Item: ItemRecord,
  ItemDisplayInfo: ItemDisplayInfoRecord,
};

export {
  CharHairGeosetsRecord,
  CharSectionsRecord,
  CharacterFacialHairStylesRecord,
  ChrRacesRecord,
  CreatureDisplayInfoExtraRecord,
  CreatureDisplayInfoRecord,
  CreatureModelDataRecord,
  DISPLAY_RECORDS,
  GameObjectDisplayInfoRecord,
  ItemDisplayInfoRecord,
  ItemRecord,
};
