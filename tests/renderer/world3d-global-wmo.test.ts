import { describe, expect, it } from 'vitest';
import { GLOBAL_AREA, WHOLE_MAP, globalWmoArea } from '../../src/renderer/world3d/scene/map/global-wmo';

describe('a map stored as one building', () => {
  it('is one area of that building: turned half a turn, at the origin, with no terrain or water', () => {
    const area = globalWmoArea({ path: 'World\wmo\Dungeon\Jail.wmo', doodadSet: 2 });
    expect(area.terrain).toEqual([]);
    expect(area.liquids).toEqual([]);
    expect(area.doodadDefs).toEqual([]);
    expect(area.objDefs).toEqual([{ id: 0, name: 'World\wmo\Dungeon\Jail.wmo', position: [0, 0, 0], rotation: [0, 0, 1, 0], doodadSet: 2 }]);
  });

  it('sits in the tile the origin is in, and asks for spawns everywhere', () => {
    // Tile 32 holds the origin: 32 tiles of 533.33 yards fill the way to the grid's corner at 17066.67
    expect(32 * 533.3333).toBeCloseTo(17066.67, 0);
    expect(GLOBAL_AREA).toEqual({ areaX: 32, areaY: 32 });
    expect(WHOLE_MAP.minX).toBeLessThan(-17066.67);
    expect(WHOLE_MAP.maxX).toBeGreaterThan(17066.67);
  });
});
