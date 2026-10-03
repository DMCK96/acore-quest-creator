// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { placementOf } from '../../src/renderer/world3d/scene/edit/Gizmo';

describe('a placed spawn as the gizmo leaves it', () => {
  it('gives an NPC its position and facing, without rotation', () => {
    const o = new THREE.Object3D();
    o.position.set(1, 2, 3);
    o.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 1.25);
    const p = placementOf(o, 'creature');
    expect([p.x, p.y, p.z, p.rotation]).toEqual([1, 2, 3, null]);
    expect(p.orientation).toBeCloseTo(1.25, 6);
  });

  it('reads an NPC drawn lifted onto the ground at the height it is stored at, so turning it does not change its Z', () => {
    const o = new THREE.Object3D();
    o.position.set(1, 2, 3.4);
    o.userData.lift = 0.4;
    expect(placementOf(o, 'creature').z).toBeCloseTo(3);
    o.userData.lift = 0;
    expect(placementOf(o, 'creature').z).toBeCloseTo(3.4);
  });

  it('gives an object its whole rotation and the facing it turns to', () => {
    const o = new THREE.Object3D();
    o.quaternion.setFromEuler(new THREE.Euler(0.3, 0, 2, 'ZYX'));
    const p = placementOf(o, 'object');
    expect(p.rotation).toEqual(o.quaternion.toArray());
    expect(p.orientation).toBeCloseTo(2, 6);
  });

  it('keeps the facing between 0 and two pi, as the server stores it', () => {
    const o = new THREE.Object3D();
    o.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -1);
    expect(placementOf(o, 'creature').orientation).toBeCloseTo(2 * Math.PI - 1, 6);
  });
});
