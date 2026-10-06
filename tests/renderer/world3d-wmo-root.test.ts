import { describe, expect, it } from 'vitest';
import MapObj from '../../src/renderer/world3d/scene/wmo/format/MapObj';

const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};
const chunk = (tag: string, data: Buffer): Buffer => Buffer.concat([Buffer.from([...tag].reverse().join('')), u32(data.length), data]);

const mohd = (): Buffer => Buffer.alloc(64);
const material = (texture1: number, texture2: number): Buffer => {
  const momt = Buffer.alloc(64);
  momt.writeUInt32LE(texture1, 12);
  momt.writeUInt32LE(texture2, 24);
  return momt;
};
const groupInfo = (nameOffset: number): Buffer => {
  const mogi = Buffer.alloc(32);
  mogi.writeInt32LE(nameOffset, 28);
  return mogi;
};
/** The root file as the loader hands it over: its own ArrayBuffer */
const load = (...chunks: Buffer[]) => new MapObj().load(new Uint8Array(Buffer.concat([chunk('MVER', u32(17)), chunk('MOHD', mohd()), ...chunks])).buffer);

describe('a building root file', () => {
  it('reads its materials\' textures and its groups\' names', () => {
    const textures = Buffer.from('tileset\\brick.blp\0\0');
    const root = load(
      chunk('MOTX', textures),
      chunk('MOMT', material(0, textures.length - 1)),
      chunk('MOGN', Buffer.from('\0house\0')),
      chunk('MOGI', groupInfo(1)),
    );
    expect(root.materials.map((m) => m.textures)).toEqual([['tileset\\brick.blp']]);
    expect(root.groupInfo.map((g) => g.name)).toEqual(['house']);
  });

  // WORLDWMODRAENORIRONHORDEIH_IRONHORDE_DAM.WMO in the Ascension client failed with "Unknown source
  // type": its materials name textures, but it has no texture table to name them from
  it('without a texture table still loads, its materials untextured', () => {
    const root = load(chunk('MOMT', material(0, 0)), chunk('MOGN', Buffer.from('dam\0')), chunk('MOGI', groupInfo(0)));
    expect(root.materials).toHaveLength(1);
    expect(root.materials[0]!.textures).toEqual([]);
    expect(root.groupInfo.map((g) => g.name)).toEqual(['dam']);
  });

  it('without a group name table still loads, its groups unnamed', () => {
    const root = load(chunk('MOTX', Buffer.from('a.blp\0')), chunk('MOMT', material(0, 0)), chunk('MOGI', groupInfo(0)));
    expect(root.groupInfo).toHaveLength(1);
    expect(root.groupInfo[0]!.name).toBeUndefined();
  });
});
