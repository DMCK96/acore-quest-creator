import { describe, expect, it } from 'vitest';
import { NODE_STOP, type TaxiNode } from '../../src/core/game/taxi-path';
import { buildTransportMaps } from '../../src/core/map/transports';
import { WORLD_MAPS } from '../../src/core/map/world-maps';
import { buildDbcWithStrings } from '../helpers/dbc';

const node = (index: number, map: number, x: number, y: number, flags = 0): TaxiNode => ({ index, map, x, y, z: 10, flags, delay: 0 });
const hostOf = (id: number) => WORLD_MAPS.find((m) => m.id === id) ?? null;
const row = (cells: Record<number, number | string>) => Array.from({ length: 66 }, (_, i) => cells[i] ?? 0);
const mapDbc = buildDbcWithStrings([row({ 0: 591, 1: 'Transport', 2: 0, 5: 'Orgrimmar and Undercity Zeppelin' }), row({ 0: 672, 1: 'Transport', 2: 0, 5: 'Alliance Gunship' })], 66);
const paths = new Map([
  [302, [node(0, 1, 1000, -4000), node(1, 1, 1100, -4000, NODE_STOP), node(2, 0, 50, 50)]],
  [1814, [node(0, 0, 5, 5)]],
  [1819, [node(0, 0, 8, 8)]],
  [999, [node(0, 777, 1, 1)]],
]);
const zeppelin = { entry: 164871, name: 'Zeppelin (The Thundercaller)', displayId: 3031, pathId: 302, map: 591 };

describe('building transport maps', () => {
  it('makes one map per transport map, named by Map.dbc, starting at the first stop on a drawable map', () => {
    const [m] = buildTransportMaps({ rows: [zeppelin], paths, mapDbc, hostOf });
    expect(m).toMatchObject({ id: 591, name: 'Orgrimmar and Undercity Zeppelin', kind: 'transport', directory: 'kalimdor', start: { x: 1100, y: -4000, z: 10 } });
    expect(m!.transport!.templates).toEqual([{ entry: 164871, name: 'Zeppelin (The Thundercaller)', displayId: 3031, pathId: 302 }]);
    expect(m!.transport!.paths[302]).toHaveLength(3);
  });

  it('groups templates that share a map into one entry', () => {
    const rows = [
      { entry: 201580, name: 'The Skybreaker', displayId: 9150, pathId: 1814, map: 672 },
      { entry: 201811, name: 'The Skybreaker', displayId: 9150, pathId: 1819, map: 672 },
    ];
    const maps = buildTransportMaps({ rows, paths, mapDbc, hostOf });
    expect(maps).toHaveLength(1);
    expect(maps[0]!.transport!.templates.map((t) => t.entry)).toEqual([201580, 201811]);
    expect(Object.keys(maps[0]!.transport!.paths).map(Number).sort()).toEqual([1814, 1819]);
  });

  it('names a map Map.dbc lacks after its first template', () => {
    const [m] = buildTransportMaps({ rows: [{ ...zeppelin, map: 700 }], paths, mapDbc, hostOf });
    expect(m!.name).toBe('Zeppelin (The Thundercaller)');
  });

  it('leaves out a template on a continent, one with no path, and one whose nodes cannot be drawn', () => {
    const rows = [
      { ...zeppelin, entry: 1, map: 0 },
      { ...zeppelin, entry: 2, pathId: 12345, map: 591 },
      { ...zeppelin, entry: 3, pathId: 999, map: 591 },
    ];
    expect(buildTransportMaps({ rows, paths, mapDbc, hostOf })).toEqual([]);
  });

  it('works without a Map.dbc and without rows', () => {
    expect(buildTransportMaps({ rows: [zeppelin], paths, mapDbc: null, hostOf })[0]!.name).toBe('Zeppelin (The Thundercaller)');
    expect(buildTransportMaps({ rows: [], paths, mapDbc, hostOf })).toEqual([]);
  });
});
