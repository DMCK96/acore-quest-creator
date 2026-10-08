import { describe, expect, it } from 'vitest';
import { dockInRange } from '../../src/renderer/world3d/scene/spawn/dock-range';

// Tiles are 533.33 yards; areaX counts north to south, areaY west to east. (-100, -100) is well inside tile 32:32.
describe('whether a dock is close enough to be drawn', () => {
  const at = { x: -100, y: -100 };
  it('is in range in the camera’s own tile', () => {
    expect(dockInRange(at, { areaX: 32, areaY: 32 })).toBe(true);
  });
  it('is in range one tile away in any direction, and out of range two tiles away', () => {
    expect(dockInRange(at, { areaX: 33, areaY: 31 })).toBe(true);
    expect(dockInRange(at, { areaX: 34, areaY: 32 })).toBe(false);
    expect(dockInRange(at, { areaX: 32, areaY: 30 })).toBe(false);
  });
  it('is out of range for a position off the world grid', () => {
    expect(dockInRange({ x: 1e6, y: 1e6 }, { areaX: 32, areaY: 32 })).toBe(false);
  });
});
