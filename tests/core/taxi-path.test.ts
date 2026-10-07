import { describe, expect, it } from 'vitest';
import { DbcFormatError } from '../../src/core/game/dbc';
import { NODE_STOP, NODE_TELEPORT, TAXI_PATH_NODE_FILE, parseTaxiPathNodes } from '../../src/core/game/taxi-path';
import { buildDbc, f32 } from '../helpers/dbc';

/** id, pathId, nodeIndex, mapId, x, y, z, flags, delay, arrivalEventId, departureEventId */
const node = (id: number, path: number, index: number, map: number, x: number, y: number, z: number, flags = 0, delay = 0) =>
  [id, path, index, map, f32(x), f32(y), f32(z), flags, delay, 0, 0];

describe('reading TaxiPathNode.dbc', () => {
  it('groups nodes by path and orders each path by node index, whatever order the rows come in', () => {
    const paths = parseTaxiPathNodes(buildDbc([node(3, 302, 2, 1, 30, 0, 0), node(1, 302, 0, 1, 10, 0, 0), node(9, 55, 0, 0, 5, 5, 5), node(2, 302, 1, 1, 20, 0, 0)], 11));
    expect([...paths.keys()].sort((a, b) => a - b)).toEqual([55, 302]);
    expect(paths.get(302)!.map((n) => n.index)).toEqual([0, 1, 2]);
    expect(paths.get(302)!.map((n) => n.x)).toEqual([10, 20, 30]);
  });

  it('reads the map, the position, the flags and the delay of a node', () => {
    const [n] = parseTaxiPathNodes(buildDbc([node(1, 7, 0, 571, -1.5, 2.25, 3.75, NODE_STOP, 30000)], 11)).get(7)!;
    expect(n).toEqual({ index: 0, map: 571, x: -1.5, y: 2.25, z: 3.75, flags: NODE_STOP, delay: 30000 });
    expect(NODE_TELEPORT).toBe(1);
  });

  it('refuses a file that has too few fields to be a TaxiPathNode table, naming the file', () => {
    expect(() => parseTaxiPathNodes(buildDbc([[1, 2, 3]], 3))).toThrow(DbcFormatError);
    expect(() => parseTaxiPathNodes(buildDbc([[1, 2, 3]], 3))).toThrow(TAXI_PATH_NODE_FILE);
  });

  it('gives an empty map for a file with no rows', () => {
    expect(parseTaxiPathNodes(buildDbc([], 11)).size).toBe(0);
  });
});
