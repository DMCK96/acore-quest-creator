import { describe, expect, it } from 'vitest';
import { centreOf, movedBy, turnedAbout, turnQuaternion } from '../../src/renderer/world3d/scene/edit/group';

describe('moving and turning a group', () => {
  it('finds the middle of what is selected', () => {
    expect(centreOf([{ x: 0, y: 0, z: 0 }, { x: 10, y: 4, z: 2 }])).toEqual({ x: 5, y: 2, z: 1 });
  });

  it('moves each by its share of the drag', () => {
    expect(movedBy({ x: 1, y: 2, z: 3 }, { x: 4, y: -2, z: 1 }, 1)).toEqual({ x: 5, y: 0, z: 4 });
    expect(movedBy({ x: 1, y: 2, z: 3 }, { x: 4, y: -2, z: 1 }, 0.5)).toEqual({ x: 3, y: 1, z: 3.5 });
  });

  it('swings each round the centre about Z, keeping its height', () => {
    const p = turnedAbout({ x: 10, y: 0, z: 7 }, { x: 5, y: 0 }, Math.PI / 2);
    expect(p.x).toBeCloseTo(5, 9);
    expect(p.y).toBeCloseTo(5, 9);
    expect(p.z).toBe(7);
  });

  it('turns a rotation about Z by the same angle, on top of any tilt', () => {
    const [x, y, z, w] = turnQuaternion([0, 0, 0, 1], Math.PI / 2);
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(Math.sin(Math.PI / 4), 6);
    expect(w).toBeCloseTo(Math.cos(Math.PI / 4), 6);
    // A tilt about X stays a tilt, now about the turned axis: Z-turn × tilt
    const tilt: [number, number, number, number] = [Math.sin(0.15), 0, 0, Math.cos(0.15)];
    const turned = turnQuaternion(tilt, Math.PI);
    expect(turned[0]).toBeCloseTo(0, 6);
    expect(Math.abs(turned[1])).toBeCloseTo(Math.sin(0.15), 6);
  });
});
