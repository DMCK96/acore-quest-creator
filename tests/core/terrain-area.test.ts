import { describe, expect, it } from 'vitest';
import { areaAt, parseMapArea, parseMapFile } from '../../src/core/game/terrain';
import { buildMapFile } from '../helpers/map-file';

const G = 533.3333;

describe('terrain areas', () => {
  it('reads the area of each cell as the server does', () => {
    const file = parseMapFile(buildMapFile({ kind: 'flat', gridHeight: 0, area: { gridArea: 12, cells: (row, col) => 1000 + row * 16 + col } }));
    expect(areaAt(file, (-3.5 * G) / 16, (-5.5 * G) / 16)).toBe(1053);
    expect(areaAt(file, (-15.5 * G) / 16, (-0.5 * G) / 16)).toBe(1240);
  });
  it("uses the grid's one area when it has no cells", () => {
    const file = parseMapFile(buildMapFile({ kind: 'flat', gridHeight: 0, area: { gridArea: 12 } }));
    expect(areaAt(file, -100, -100)).toBe(12);
  });
  it('reads just the areas, without the heights, the same way', () => {
    const bytes = buildMapFile({ kind: 'float', gridHeight: 0, v9: () => 5, v8: () => 5, area: { gridArea: 12, cells: (row, col) => 1000 + row * 16 + col } });
    expect(parseMapArea(bytes)).toEqual(parseMapFile(bytes).area);
    expect(parseMapArea(buildMapFile({ kind: 'flat', gridHeight: 0 }))).toBeNull();
  });
  it('has no area without an area section', () => {
    const file = parseMapFile(buildMapFile({ kind: 'flat', gridHeight: 0 }));
    expect(file.area).toBeNull();
    expect(areaAt(file, -100, -100)).toBe(0);
  });
});
