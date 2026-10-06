import { describe, expect, it } from 'vitest';
import { interiorDoodads } from '../../src/renderer/world3d/scene/wmo/doodads';
import type { WmoDoodadsSpec } from '../../src/renderer/world3d/scene/wmo/loader/types';

const UPRIGHT = [0, 0, 0, 1];
/** Turned a quarter about Z: the building's +X becomes the world's +Y */
const QUARTER = [0, 0, Math.SQRT1_2, Math.SQRT1_2];

const doodads: WmoDoodadsSpec = {
  sets: [
    { startIndex: 0, count: 2 }, // the default set: a chair and a table
    { startIndex: 2, count: 1 }, // a party: a keg
    { startIndex: 3, count: 1 }, // another: a doodad with no name
  ],
  defs: [
    { name: 'World\\Chair.mdx', position: [10, 0, 0], rotation: UPRIGHT, scale: 1 },
    { name: 'World\\Table.m2', position: [0, 0, 2], rotation: UPRIGHT, scale: 0.5 },
    { name: 'World\\Keg.mdl', position: [0, 5, 0], rotation: UPRIGHT, scale: 1 },
    { name: '', position: [0, 0, 0], rotation: UPRIGHT, scale: 1 },
  ],
};

const placement = (doodadSet: number, rotation = UPRIGHT) => ({ id: 77, name: 'house.wmo', position: [100, 200, 30], rotation, doodadSet });

describe('a placed building\'s doodads', () => {
  it('are its default set, placed by the building, as .m2 models', () => {
    const placed = interiorDoodads(placement(0), doodads);
    expect(placed.map((d) => [d.id, d.name, d.inside])).toEqual([
      ['77:0', 'World\\Chair.m2', true],
      ['77:1', 'World\\Table.m2', true],
    ]);
    expect(placed[0]!.position).toEqual([110, 200, 30]);
    // Full size is 1024, as the area's own doodads are given
    expect(placed[1]!.scale).toBeCloseTo(512);
  });

  it('add the set the placement picks', () => {
    expect(interiorDoodads(placement(1), doodads).map((d) => d.id)).toEqual(['77:0', '77:1', '77:2']);
  });

  it('turn with the building', () => {
    const [chair] = interiorDoodads(placement(0, QUARTER), doodads);
    const [x, y, z] = chair!.position;
    expect([x, y, z].map((v) => Math.round(v! * 1000) / 1000)).toEqual([100, 210, 30]);
    const [qx, qy, qz, qw] = chair!.rotation;
    expect([qx, qy, qz, qw].map((v) => Math.round(v! * 1000) / 1000)).toEqual([0, 0, 0.707, 0.707]);
  });

  it('leave out a doodad with no name, and a set the building does not have', () => {
    expect(interiorDoodads(placement(2), doodads).map((d) => d.id)).toEqual(['77:0', '77:1']);
    expect(interiorDoodads(placement(9), doodads).map((d) => d.id)).toEqual(['77:0', '77:1']);
  });
});
