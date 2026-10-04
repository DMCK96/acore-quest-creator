// @vitest-environment jsdom
import { ClientDb } from '@wowserhq/format';
import { describe, expect, it } from 'vitest';
import { buildDbcWithStrings, f32 } from '../helpers/dbc';
import {
  CharHairGeosetsRecord, CharSectionsRecord, CharacterFacialHairStylesRecord, ChrRacesRecord,
  CreatureDisplayInfoExtraRecord, CreatureDisplayInfoRecord, CreatureModelDataRecord, ItemDisplayInfoRecord, ItemRecord,
} from '../../src/renderer/world3d/scene/db/records';
import { DisplayResolver } from '../../src/renderer/world3d/scene/spawn/DisplayResolver';
import { applyItemGeosets } from '../../src/renderer/world3d/scene/character/outfit';

const db = (Record: any, records: (number | string)[][], fields: number): ClientDb<any> => {
  const bytes = buildDbcWithStrings(records, fields);
  return new ClientDb(Record).load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
};
// An ItemDisplayInfo row: models, model textures, geoset groups, region textures (ITEM_REGIONS order)
const display = (id: number, o: { models?: [string, string]; skins?: [string, string]; groups?: [number, number, number]; regions?: string[] }) => [
  id, ...(o.models ?? ['', '']), ...(o.skins ?? ['', '']), '', '', ...(o.groups ?? [0, 0, 0]), 0, 0, 0, 0, 0,
  ...Array.from({ length: 8 }, (_, i) => o.regions?.[i] ?? ''), 0, 0,
];

const tables: Record<string, () => ClientDb<any>> = {
  CreatureDisplayInfo: () => db(CreatureDisplayInfoRecord, [[50, 50, 0, 0, f32(1), 255], [3167, 0, 0, 500, f32(1), 255]], 16),
  CreatureModelData: () => db(CreatureModelDataRecord, [[50, 0, 'Character\\Human\\Female\\HumanFemale.mdx']], 28),
  ChrRaces: () => db(ChrRacesRecord, [[1, 0, 1, 0, 0, 50, 'Hu']], 69),
  CharHairGeosets: () => db(CharHairGeosetsRecord, [], 6),
  CharacterFacialHairStyles: () => db(CharacterFacialHairStylesRecord, [], 8),
  CharSections: () => db(CharSectionsRecord, [
    [1, 1, 1, 0, 'Skin01.blp', '', '', 0, 0, 1],
    [2, 1, 1, 1, 'FaceLower03.blp', 'FaceUpper03.blp', '', 0, 3, 1],
    [3, 1, 1, 4, 'PelvisUnder.blp', 'TorsoUnder.blp', '', 0, 0, 1],
  ], 10),
  // item id → display: 10037 shirt, 13122 chest (a robe), 1246 boots, 900 helm, 901 shoulders, 902 cape, 903 gloves
  Item: () => db(ItemRecord, [[10037, 4, 0, -1, 0, 1, 4, 0], [13122, 4, 0, -1, 0, 2, 5, 0], [1246, 4, 0, -1, 0, 3, 8, 0],
    [900, 4, 0, -1, 0, 4, 1, 0], [901, 4, 0, -1, 0, 5, 3, 0], [902, 4, 0, -1, 0, 6, 16, 0], [903, 4, 0, -1, 0, 7, 10, 0]], 8),
  ItemDisplayInfo: () => db(ItemDisplayInfoRecord, [
    display(1, { groups: [1, 0, 0], regions: ['ShirtAU'] }),
    display(2, { groups: [2, 0, 1], regions: ['', '', '', 'RobeTU', '', 'RobeLU'] }),
    display(3, { groups: [2, 0, 0], regions: ['', '', '', '', '', '', 'BootLL', 'BootFO'] }),
    display(4, { models: ['Helm_A_01.mdx', ''], skins: ['Helm_A_01Skin', ''] }),
    display(5, { models: ['LShoulder_A.mdx', 'RShoulder_A.mdx'], skins: ['Shoulder_ASkin', 'Shoulder_ASkin'] }),
    display(6, { groups: [1, 0, 0], skins: ['Cape_Red', ''] }),
    display(7, { groups: [2, 0, 0], regions: ['', '', 'GloveHA'] }),
  ], 25),
  CreatureDisplayInfoExtra: () => db(CreatureDisplayInfoExtraRecord, [
    // race 1 female, skin 1, face 3; items by display: head 4, shoulders 5, shirt 0, chest 2, ..., back 6; baked
    [500, 1, 1, 1, 3, 0, 0, 0, 4, 5, 0, 2, 0, 0, 0, 0, 0, 0, 6, 0, 'Baked.blp'],
  ], 21),
};
const resolver = (t = tables) => new DisplayResolver({ get: async (name) => (t[name] ? t[name]() : null) });
const items = (o: Partial<Record<string, number>>) => ({ head: 0, shoulders: 0, body: 0, chest: 0, waist: 0, legs: 0, feet: 0, wrists: 0, hands: 0, back: 0, tabard: 0, ...o });
const preset = (o: Partial<Record<string, number>> = {}) => ({ race: 1, sex: 1, skin: 1, face: 3, hairStyle: 0, hairColour: 0, facialHair: 0, items: items(o) as any });
const U = (folder: string, name: string) => [`Item\\TextureComponents\\${folder}\\${name}_F.blp`, `Item\\TextureComponents\\${folder}\\${name}_U.blp`];

// A preset's items are item display ids: the server sends them to the game as they are (SMSG_MIRRORIMAGE_DATA)
describe('a preset NPC dressed in its items', () => {
  it('a preset with no items is its skin, face and underwear', async () => {
    const look = (await resolver().creature(50, preset())) as any;
    expect(look.body).toEqual({
      base: 'Skin01.blp',
      layers: [
        { files: ['FaceLower03.blp'], region: 'faceLower' },
        { files: ['FaceUpper03.blp'], region: 'faceUpper' },
        { files: ['PelvisUnder.blp'], region: 'legUpper' },
        { files: ['TorsoUnder.blp'], region: 'torsoUpper' },
      ],
    });
    expect(look.textures[1]).toBe('Skin01.blp');
  });

  it('paints its items over its underwear: shirt first, boots, then the chest over them', async () => {
    const look = (await resolver().creature(50, preset({ body: 1, chest: 2, feet: 3 }))) as any;
    expect(look.body.layers.slice(4)).toEqual([
      { files: U('ArmUpperTexture', 'ShirtAU'), region: 'armUpper' },
      { files: U('LegLowerTexture', 'BootLL'), region: 'legLower' },
      { files: U('FootTexture', 'BootFO'), region: 'foot' },
      { files: U('TorsoUpperTexture', 'RobeTU'), region: 'torsoUpper' },
      { files: U('LegUpperTexture', 'RobeLU'), region: 'legUpper' },
    ]);
  });

  it('takes the shapes its items give: sleeves, robe, boots, gloves, cape', async () => {
    const look = (await resolver().creature(50, preset({ body: 1, chest: 2, feet: 3, hands: 7, back: 6 }))) as any;
    expect(look.geosets).toEqual(expect.arrayContaining([403, 503, 1302, 1502]));
    expect(look.geosets).not.toContain(401);
    expect(look.geosets).not.toContain(501);
    expect(look.geosets.filter((g: number) => g >= 1300 && g < 1400)).toEqual([1302]);
    expect(look.textures[2]).toBe('Item\\ObjectComponents\\Cape\\Cape_Red.blp');
  });

  it('wears its helmet in its race and sex, and a pad on each shoulder', async () => {
    const look = (await resolver().creature(50, preset({ head: 4, shoulders: 5 }))) as any;
    expect(look.attachments).toEqual([
      { point: 11, look: expect.objectContaining({ path: 'Item\\ObjectComponents\\Head\\Helm_A_01_HuF.m2', textures: { 2: 'Item\\ObjectComponents\\Head\\Helm_A_01Skin.blp' } }) },
      { point: 6, look: expect.objectContaining({ path: 'Item\\ObjectComponents\\Shoulder\\LShoulder_A.m2', textures: { 2: 'Item\\ObjectComponents\\Shoulder\\Shoulder_ASkin.blp' } }) },
      { point: 5, look: expect.objectContaining({ path: 'Item\\ObjectComponents\\Shoulder\\RShoulder_A.m2' }) },
    ]);
  });

  it('leaves out an item display the client does not know, and draws the rest', async () => {
    const look = (await resolver().creature(50, preset({ chest: 4242, feet: 3 }))) as any;
    expect(look.body.layers.map((l: any) => l.region)).toEqual(['faceLower', 'faceUpper', 'legUpper', 'torsoUpper', 'legLower', 'foot']);
  });
});

describe('what covers what', () => {
  it('paints a robe over trousers and boots, as the game does', async () => {
    const robe = () => db(ItemDisplayInfoRecord, [
      display(2, { groups: [2, 0, 1], regions: ['', '', '', 'RobeTU', '', 'RobeLU', 'RobeLL'] }),
      display(3, { groups: [2, 0, 0], regions: ['', '', '', '', '', '', 'BootLL', 'BootFO'] }),
      display(8, { groups: [0, 0, 0], regions: ['', '', '', '', '', 'PantLU', 'PantLL'] }),
    ], 25);
    const look = (await resolver({ ...tables, ItemDisplayInfo: robe }).creature(50, preset({ chest: 2, feet: 3, legs: 8 }))) as any;
    const firsts = look.body.layers.map((l: any) => l.files[0].split('\\').pop());
    expect(firsts.indexOf('RobeLL_F.blp')).toBeGreaterThan(firsts.indexOf('PantLL_F.blp'));
    expect(firsts.indexOf('RobeLL_F.blp')).toBeGreaterThan(firsts.indexOf('BootLL_F.blp'));
    expect(firsts.indexOf('RobeLU_F.blp')).toBeGreaterThan(firsts.indexOf('PantLU_F.blp'));
  });

  it('wears its race\'s first skin colour when its own is not in the client, never black', async () => {
    const look = (await resolver().creature(50, { ...preset(), skin: 9 })) as any;
    expect(look.textures[1]).toBe('Skin01.blp');
    expect(look.body.base).toBe('Skin01.blp');
  });
});

describe('an NPC dressed by its display\'s item displays', () => {
  it('a baked NPC keeps its texture and gains item shapes, its cape and its helmet', async () => {
    const look = (await resolver().creature(3167)) as any;
    expect(look.textures[1]).toBe('Textures\\BakedNpcTextures\\Baked.blp');
    expect(look.body).toBeUndefined();
    expect(look.geosets).toEqual(expect.arrayContaining([1302, 1502]));
    expect(look.textures[2]).toBe('Item\\ObjectComponents\\Cape\\Cape_Red.blp');
    expect(look.attachments.map((a: any) => a.point)).toEqual([11, 6, 5]);
  });

  it('one with no baked texture is built from its item displays', async () => {
    const unbaked = () => db(CreatureDisplayInfoExtraRecord, [[500, 1, 1, 1, 3, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, '']], 21);
    const look = (await resolver({ ...tables, CreatureDisplayInfoExtra: unbaked }).creature(3167)) as any;
    expect(look.body.base).toBe('Skin01.blp');
    expect(look.body.layers.map((l: any) => l.files[0])).toContain('Item\\TextureComponents\\TorsoUpperTexture\\RobeTU_F.blp');
  });
});

describe('the shapes items give', () => {
  it('sets one geoset per group, the chest\'s robe over the legs\' one', () => {
    const geosets = new Set([0, 401, 501, 1301]);
    applyItemGeosets(geosets, 'legs', [2, 1, 3]);
    applyItemGeosets(geosets, 'chest', [1, 2, 2]);
    applyItemGeosets(geosets, 'waist', [1, 0, 0]);
    applyItemGeosets(geosets, 'tabard', [0, 0, 0]);
    expect([...geosets].sort((a, b) => a - b)).toEqual([0, 401, 501, 802, 902, 1003, 1103, 1202, 1303, 1802]);
  });
});
