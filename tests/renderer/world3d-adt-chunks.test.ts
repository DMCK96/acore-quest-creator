import { describe, expect, it } from 'vitest';
import { readObjDefDoodadSets } from '../../src/renderer/world3d/scene/map/loader/adt-chunks';

const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};
const chunk = (tag: string, data: Buffer): Buffer => Buffer.concat([Buffer.from([...tag].reverse().join('')), u32(data.length), data]);

/** An area file of MVER, MHDR and MODF, MHDR pointing at MODF as the game reads it */
const area = (sets: number[]): ArrayBuffer => {
  const placements = Buffer.concat(sets.map((set) => {
    const modf = Buffer.alloc(64);
    modf.writeUInt16LE(0xffff, 56); // flags, beside the set: not part of it
    modf.writeUInt16LE(set, 58);
    return modf;
  }));
  const header = Buffer.alloc(64);
  header.writeUInt32LE(64, 32); // MODF just after MHDR's 64 bytes of data
  const bytes = Buffer.concat([chunk('MVER', u32(18)), chunk('MHDR', header), chunk('MODF', placements)]);
  return new Uint8Array(bytes).buffer;
};

describe('a map area file\'s building placements', () => {
  it('give each placement\'s doodad set, in file order', () => {
    expect(readObjDefDoodadSets(area([0, 3, 1]))).toEqual([0, 3, 1]);
  });

  it('give none when the area places no buildings', () => {
    const header = Buffer.alloc(64);
    const bytes = Buffer.concat([chunk('MVER', u32(18)), chunk('MHDR', header)]);
    expect(readObjDefDoodadSets(new Uint8Array(bytes).buffer)).toEqual([]);
  });
});
