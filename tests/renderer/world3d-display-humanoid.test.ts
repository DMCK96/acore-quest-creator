// @vitest-environment jsdom
import { ClientDb } from '@wowserhq/format';
import { describe, expect, it } from 'vitest';
import { buildDbcWithStrings, f32 } from '../helpers/dbc';
import {
  CharHairGeosetsRecord, CharSectionsRecord, CharacterFacialHairStylesRecord, ChrRacesRecord,
  CreatureDisplayInfoExtraRecord, CreatureDisplayInfoRecord, CreatureModelDataRecord,
} from '../../src/renderer/world3d/scene/db/records';
import { DEFAULT_CHARACTER_GEOSETS, DisplayResolver } from '../../src/renderer/world3d/scene/spawn/DisplayResolver';

const db = (Record: any, records: (number | string)[][], fields: number): ClientDb<any> => {
  const bytes = buildDbcWithStrings(records, fields);
  return new ClientDb(Record).load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
};

const tables: Record<string, () => ClientDb<any>> = {
  // Display 3167 is a humanoid (extra 500); display 49 is the human male body
  CreatureDisplayInfo: () => db(CreatureDisplayInfoRecord, [[3167, 0, 0, 500, f32(1), 255], [49, 49, 0, 0, f32(1), 255]], 16),
  CreatureModelData: () => db(CreatureModelDataRecord, [[49, 0, 'Character\\Human\\Male\\HumanMale.mdx']], 28),
  // id, race 1 (human), sex 0, skin, face, hair style 4, hair colour 2, facial hair 3, 11 item displays, flags, bake name
  CreatureDisplayInfoExtra: () => db(CreatureDisplayInfoExtraRecord, [[500, 1, 0, 0, 0, 4, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'CreatureDisplayExtra-00500.blp']], 21),
  // id 1 (human): male display 49, female 50
  ChrRaces: () => db(ChrRacesRecord, [[1, 0, 1, 0, 49, 50]], 69),
  // race 1, sex 0, style 4 → hair geoset 5
  CharHairGeosets: () => db(CharHairGeosetsRecord, [[1, 1, 0, 4, 5, 0]], 6),
  // race 1, sex 0, base section 3 (hair), textures, flags, variation 4, colour 2
  CharSections: () => db(CharSectionsRecord, [[7, 1, 0, 3, 'Character\\Human\\Hair04_02.blp', '', '', 0, 4, 2]], 10),
  // race 1, sex 0, variation 3 → geosets 2, 1, 3 for groups 1, 2, 3
  CharacterFacialHairStyles: () => db(CharacterFacialHairStylesRecord, [[1, 0, 3, 2, 1, 3, 0, 0]], 8),
};

const resolver = (t = tables) => new DisplayResolver({ get: async (name) => (t[name] ? t[name]() : null) });

describe('a humanoid NPC\'s look', () => {
  it('is its race\'s body in its baked texture and hair, with its hair and beard geosets', async () => {
    const look = await resolver().creature(3167);
    expect(look).toEqual({
      kind: 'model',
      path: 'Character\\Human\\Male\\HumanMale.m2',
      textures: { 1: 'Textures\\BakedNpcTextures\\CreatureDisplayExtra-00500.blp', 6: 'Character\\Human\\Hair04_02.blp' },
      geosets: [0, 5, 102, 201, 303, 401, 501, 702, 1301],
      scale: 1,
    });
  });

  it('shows the bare body when it has no hair or beard rows', async () => {
    const look = (await resolver({ ...tables, CharHairGeosets: () => db(CharHairGeosetsRecord, [], 6), CharacterFacialHairStyles: () => db(CharacterFacialHairStylesRecord, [], 8) }).creature(3167)) as any;
    expect(look.geosets).toEqual(DEFAULT_CHARACTER_GEOSETS);
  });

  it('cannot be drawn when its race has no body', async () => {
    expect(await resolver({ ...tables, ChrRaces: () => db(ChrRacesRecord, [], 69) }).creature(3167)).toBeNull();
  });

  it('has no hair texture, but still draws, when the client has no hair section for it', async () => {
    const look = (await resolver({ ...tables, CharSections: () => db(CharSectionsRecord, [], 10) }).creature(3167)) as any;
    expect(look.textures).toEqual({ 1: 'Textures\\BakedNpcTextures\\CreatureDisplayExtra-00500.blp' });
  });
});
