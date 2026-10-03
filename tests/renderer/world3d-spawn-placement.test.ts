// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { areaBox, creatureTransform, objectTransform } from '../../src/renderer/world3d/scene/spawn/placement';

describe('where a spawn stands', () => {
  it('puts a creature at its spot, turned about Z by its facing, at its scale', () => {
    const t = creatureTransform({ x: 1, y: 2, z: 3, orientation: Math.PI / 2, scale: 2 });
    expect(t.position).toEqual([1, 2, 3]);
    expect(t.scale).toBe(2);
    const facing = new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion(...t.quaternion));
    expect(facing.x).toBeCloseTo(0, 6);
    expect(facing.y).toBeCloseTo(1, 6);
  });

  it('turns an object by its own rotation and sizes it', () => {
    const t = objectTransform({ x: 0, y: 0, z: 0, rotation: [0, 0, 0.7071068, 0.7071068], scale: 1.5 });
    expect(t.quaternion).toEqual([0, 0, 0.7071068, 0.7071068]);
    expect(t.scale).toBe(1.5);
  });

  it('keeps an object upright when its rotation is all zero (old rows)', () => {
    expect(objectTransform({ x: 0, y: 0, z: 0, rotation: [0, 0, 0, 0], scale: 1 }).quaternion).toEqual([0, 0, 0, 1]);
  });

  it('gives a tile its bounds in server X and Y', () => {
    // Tile (areaX 48, areaY 32) holds Northshire Abbey at (-8913, -137)
    const box = areaBox(48, 32);
    expect(box.minX).toBeLessThan(-8913);
    expect(box.maxX).toBeGreaterThan(-8913);
    expect(box.minY).toBeLessThan(-137);
    expect(box.maxY).toBeGreaterThan(-137);
    expect(box.maxX - box.minX).toBeCloseTo(533.3333, 3);
  });
});
