import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { moveRouteDrawing, routeObject, setBallSelected, wanderObject } from '../../src/renderer/world3d/scene/spawn/paths';

const creature = { x: 0, y: 0, z: 0, own: false, path: [{ x: 10, y: 0, z: 0 }, { x: 10, y: 10, z: 0 }] };
const balls = (g: THREE.Object3D) => g.children.filter((c) => typeof c.userData.point === 'number') as THREE.Mesh[];
const arrows = (g: THREE.Object3D) => g.children.filter((c) => c.userData.arrow === true);
const line = (g: THREE.Object3D) => g.children.find((c) => c instanceof THREE.Line) as THREE.Line;

describe('a route redrawn while its points are dragged', () => {
  it('moves the line, the balls and the arrows to the new points', () => {
    const route = routeObject(creature)!;
    moveRouteDrawing(route, { x: 0, y: 0, z: 0 }, [{ x: 20, y: 0, z: 1 }, { x: 10, y: 10, z: 0 }]);
    expect(Array.from(line(route).geometry.getAttribute('position').array)).toEqual([0, 0, 0, 20, 0, 1, 10, 10, 0, 20, 0, 1]);
    expect(balls(route).map((b) => b.position.toArray())).toEqual([[20, 0, 1], [10, 10, 0]]);
    // One arrow per leg with a length: home to 1, 1 to 2, 2 back to 1
    expect(arrows(route)).toHaveLength(3);
    expect(arrows(route)[0]!.position.toArray()).toEqual([10, 0, 0.5]);
  });

  it('is left out of the scene’s every-frame matrix pass, and still moves when it is moved', () => {
    const route = routeObject(creature)!;
    expect(route.matrixWorldAutoUpdate).toBe(false);
    moveRouteDrawing(route, { x: 0, y: 0, z: 0 }, [{ x: 20, y: 0, z: 1 }, { x: 10, y: 10, z: 0 }]);
    expect(balls(route)[0]!.matrixWorld.elements[12]).toBeCloseTo(20);
    expect(wanderObject({ x: 0, y: 0, z: 0, wander: 5, own: false })!.matrixWorldAutoUpdate).toBe(false);
  });

  it('marks a picked point larger and in the selection colour, and back', () => {
    const route = routeObject(creature)!;
    const [ball] = balls(route);
    const plain = ball!.material;
    setBallSelected(ball!, true);
    expect(ball!.scale.x).toBeGreaterThan(1);
    expect((ball!.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0xffd34d);
    setBallSelected(ball!, false);
    expect(ball!.scale.x).toBe(1);
    expect(ball!.material).toBe(plain);
  });
});
