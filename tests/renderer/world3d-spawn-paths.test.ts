// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { OWN_COLOUR, PATH_COLOUR, routeObject, wanderObject } from '../../src/renderer/world3d/scene/spawn/paths';

const linePoints = (line: THREE.Line) => {
  const p = line.geometry.getAttribute('position');
  return Array.from({ length: p.count }, (_, i) => [p.getX(i), p.getY(i), p.getZ(i)]);
};

describe('a patrol route in 3D', () => {
  const walker = { x: 0, y: 0, z: 0, path: [{ x: 10, y: 0, z: 0 }, { x: 10, y: 10, z: 0 }], own: false };

  it('runs from the spawn through each point and back to the first', () => {
    const route = routeObject(walker)!;
    const line = route.children.find((c) => c instanceof THREE.Line) as THREE.Line;
    expect(linePoints(line)).toEqual([[0, 0, 0], [10, 0, 0], [10, 10, 0], [10, 0, 0]]);
    expect(((line.material as THREE.LineBasicMaterial).color.getHex())).toBe(PATH_COLOUR);
  });

  it('marks each point and points an arrow along each leg', () => {
    const route = routeObject(walker)!;
    expect(route.children.filter((c) => (c as THREE.Mesh).geometry instanceof THREE.SphereGeometry)).toHaveLength(2);
    const arrows = route.children.filter((c) => (c as THREE.Mesh).geometry instanceof THREE.ConeGeometry);
    expect(arrows).toHaveLength(3);
    // The first leg runs +X: its arrow (a cone, whose tip is +Y in its own space) points +X
    const tip = new THREE.Vector3(0, 1, 0).applyQuaternion(arrows[0]!.quaternion);
    expect(tip.x).toBeCloseTo(1, 5);
  });

  it('is drawn in the project colour for the project\'s own NPCs', () => {
    const line = routeObject({ ...walker, own: true })!.children.find((c) => c instanceof THREE.Line) as THREE.Line;
    expect(((line.material as THREE.LineBasicMaterial).color.getHex())).toBe(OWN_COLOUR);
  });

  it('is nothing for an NPC with no route', () => {
    expect(routeObject({ ...walker, path: null })).toBeNull();
    expect(routeObject({ ...walker, path: [] })).toBeNull();
  });
});

describe('a wander circle in 3D', () => {
  it('rings the spawn at the wander radius, just above it', () => {
    const ring = wanderObject({ x: 5, y: 5, z: 1, wander: 8, own: false })!;
    const pts = linePoints(ring);
    expect(pts).toHaveLength(48);
    for (const [x, y, z] of pts) {
      expect(Math.hypot(x! - 5, y! - 5)).toBeCloseTo(8, 5);
      expect(z).toBeCloseTo(1.2, 5);
    }
  });

  it('is nothing for an NPC that stands still', () => {
    expect(wanderObject({ x: 0, y: 0, z: 0, wander: 0, own: false })).toBeNull();
  });
});
