import { describe, expect, it } from 'vitest';
import { gridFileName, parseMapFile, terrainHeight } from '../../src/core/game/terrain';
import { buildMapFile } from '../helpers/map-file';

const GRID = 533.3333;
/** World coordinates of cell (i, j) plus fractions (fx, fy) inside grid (gx, gy). */
const world = (gx: number, gy: number, i: number, j: number, fx: number, fy: number) => ({
  x: (32 - gx - (i + fx) / 128) * GRID,
  y: (32 - gy - (j + fy) / 128) * GRID,
});

describe('terrain files', () => {
  it('names the grid file the server loads for a point', () => {
    expect(gridFileName(0, -8913.2, -136.5)).toBe('0004832.map');
    expect(gridFileName(1, 0.01, 0.01)).toBe('0013131.map');
    expect(gridFileName(1, -0.01, -0.01)).toBe('0013232.map');
  });
  it('reads a flat grid as one height', () => {
    const file = parseMapFile(buildMapFile({ kind: 'flat', gridHeight: 42.5 }));
    const p = world(48, 32, 10, 10, 0.3, 0.6);
    expect(terrainHeight(file, p.x, p.y)).toBeCloseTo(42.5, 4);
  });
  it('interpolates float heights across the four triangles like the server', () => {
    const file = parseMapFile(buildMapFile({ kind: 'float', gridHeight: 0, v9: (i, j) => i * 10 + j, v8: (i, j) => i * 10 + j + 5.5 }));
    // A plane h = 10i + j on the corners, and its centre values (10i + j + 5.5) in the middle.
    const at = (fx: number, fy: number) => terrainHeight(file, world(48, 32, 20, 30, fx, fy).x, world(48, 32, 20, 30, fx, fy).y)!;
    // Every triangle reproduces the plane h = 10·(20 + fx) + (30 + fy) exactly.
    expect(at(0.25, 0.1)).toBeCloseTo(232.6, 3);  // triangle 1
    expect(at(0.1, 0.25)).toBeCloseTo(231.25, 3); // triangle 2
    expect(at(0.75, 0.6)).toBeCloseTo(238.1, 3);  // triangle 3
    expect(at(0.6, 0.75)).toBeCloseTo(236.75, 3); // triangle 4
  });
  it('scales 16-bit heights between the grid minimum and maximum', () => {
    const file = parseMapFile(buildMapFile({ kind: 'uint16', gridHeight: 100, gridMaxHeight: 165.535, v9: () => 1000, v8: () => 1000 }));
    const p = world(40, 40, 5, 5, 0.5, 0.2);
    expect(terrainHeight(file, p.x, p.y)).toBeCloseTo(100 + 1000 * (65.535 / 65535), 3);
  });
  it('has no ground in a hole', () => {
    const holes = new Uint16Array(256);
    holes[1 * 16 + 2] = 0xffff; // cell row 1, column 2
    const file = parseMapFile(buildMapFile({ kind: 'flat', gridHeight: 5, holes }));
    const inHole = world(48, 32, 1 * 8 + 3, 2 * 8 + 3, 0.5, 0.5);
    const outside = world(48, 32, 0, 0, 0.5, 0.5);
    expect(terrainHeight(file, inHole.x, inHole.y)).toBeNull();
    expect(terrainHeight(file, outside.x, outside.y)).toBeCloseTo(5, 4);
  });
  it('refuses a file that is not a map file', () => {
    expect(() => parseMapFile(new Uint8Array(44))).toThrow(/not a map file/);
  });
});
