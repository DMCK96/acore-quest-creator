// @vitest-environment jsdom
import { ClientDb } from '@wowserhq/format';
import { describe, expect, it } from 'vitest';
import { buildDbcWithStrings, f32 } from '../helpers/dbc';
import { CreatureDisplayInfoRecord, CreatureModelDataRecord, GameObjectDisplayInfoRecord } from '../../src/renderer/world3d/scene/db/records';
import { DisplayResolver, modelPath } from '../../src/renderer/world3d/scene/spawn/DisplayResolver';

const db = (Record: any, records: (number | string)[][], fields: number) => {
  const bytes = buildDbcWithStrings(records, fields);
  return new ClientDb(Record).load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
};

// CreatureDisplayInfo: id, model, sound, extra, scale, alpha, skin1..3, portrait, ... (16)
const displays = () => db(CreatureDisplayInfoRecord, [
  [100, 10, 0, 0, f32(1.5), 255, 'WolfSkinGrey', '', '', ''],
  [101, 99, 0, 0, f32(1), 255, '', '', '', ''],
], 16);
// CreatureModelData: id, flags, model name, ... (28)
const models = () => db(CreatureModelDataRecord, [[10, 0, 'Creature\\Wolf\\Wolf.mdx']], 28);
// GameObjectDisplayInfo: id, model name, ... (19)
const objects = () => db(GameObjectDisplayInfoRecord, [
  [1949, 'World\\Generic\\Human\\Passive Doodads\\Mailbox\\Mailbox.MDX'],
  [500, 'World\\wmo\\Dungeon\\Test\\Gate.wmo'],
], 19);

const resolver = (tables: Record<string, () => ClientDb<any>> = { CreatureDisplayInfo: displays, CreatureModelData: models, GameObjectDisplayInfo: objects }) =>
  new DisplayResolver({ get: async (name) => (tables[name] ? tables[name]() : null) });

describe('what a display looks like', () => {
  it('reads the confirmed field counts from client-shaped files', () => {
    expect(displays().getRecord(100).textureVariations).toEqual(['WolfSkinGrey', '', '']);
    expect(models().getRecord(10).modelName).toBe('Creature\\Wolf\\Wolf.mdx');
  });

  it('gives a plain creature its model and the skins that fill slots 11, 12 and 13, beside the model', async () => {
    expect(await resolver().creature(100)).toEqual({
      kind: 'model', path: 'Creature\\Wolf\\Wolf.m2', textures: { 11: 'Creature\\Wolf\\WolfSkinGrey.blp' }, geosets: null, scale: 1.5,
    });
  });

  it('cannot draw a display that is 0, unknown, or names a model that is not listed', async () => {
    const r = resolver();
    expect(await r.creature(0)).toBeNull();
    expect(await r.creature(12345)).toBeNull();
    expect(await r.creature(101)).toBeNull();
  });

  it('gives an object a model, or a building when its file is a .wmo', async () => {
    const r = resolver();
    expect(await r.object(1949)).toEqual({ kind: 'model', path: 'World\\Generic\\Human\\Passive Doodads\\Mailbox\\Mailbox.m2', textures: {}, geosets: null, scale: 1 });
    expect(await r.object(500)).toEqual({ kind: 'building', path: 'World\\wmo\\Dungeon\\Test\\Gate.wmo', scale: 1 });
  });

  it('cannot draw anything of a kind whose table the client lacks', async () => {
    const r = resolver({});
    expect(await r.creature(100)).toBeNull();
    expect(await r.object(1949)).toBeNull();
  });

  it('turns .mdx and .mdl into .m2, whatever their case', () => {
    expect(modelPath('A\\B.mdx')).toBe('A\\B.m2');
    expect(modelPath('A\\B.MDL')).toBe('A\\B.m2');
    expect(modelPath('A\\B.m2')).toBe('A\\B.m2');
  });
});
