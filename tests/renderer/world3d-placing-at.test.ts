import { describe, expect, it } from 'vitest';
import { placementAt } from '../../src/renderer/world3d/placing';

describe('where a placed spawn stands and faces', () => {
  const ground = { x: 10, y: 20, z: 5 };

  it('stands on the clicked ground and faces the camera', () => {
    // The camera is north (+X) of it: facing 0
    expect(placementAt(ground, { x: 30, y: 20 }, 'creature')).toMatchObject({ x: 10, y: 20, z: 5, orientation: 0 });
    // West (+Y) of it: a quarter turn
    expect(placementAt(ground, { x: 10, y: 40 }, 'creature').orientation).toBeCloseTo(Math.PI / 2);
    // South of it: a half turn; east of it (a negative angle) comes round to three quarters
    expect(placementAt(ground, { x: -10, y: 20 }, 'creature').orientation).toBeCloseTo(Math.PI);
    expect(placementAt(ground, { x: 10, y: 0 }, 'creature').orientation).toBeCloseTo((3 * Math.PI) / 2);
  });

  it('gives an NPC no rotation, and an object the turn about Z that its facing is', () => {
    expect(placementAt(ground, { x: 10, y: 40 }, 'creature').rotation).toBeNull();
    const [x, y, z, w] = placementAt(ground, { x: 10, y: 40 }, 'object').rotation!;
    expect([x, y]).toEqual([0, 0]);
    expect(z).toBeCloseTo(Math.sin(Math.PI / 4));
    expect(w).toBeCloseTo(Math.cos(Math.PI / 4));
  });
});
