// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Gizmo, placementOf } from '../../src/renderer/world3d/scene/edit/Gizmo';

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

describe('the handles follow the spawn they are on', () => {
  const Z = new THREE.Vector3(0, 0, 1);
  const gizmo = () => new Gizmo(new THREE.PerspectiveCamera(), document.createElement('div'), new THREE.Scene(), () => [], { started: () => {}, moved: () => {}, ended: () => {} });
  const tilted = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 0, 0.8, 'ZYX'));

  it('are drawn along the spawn, not the world', () => {
    const g = gizmo();
    g.attach(new THREE.Vector3(), new THREE.Quaternion().setFromAxisAngle(Z, Math.PI / 4), 'z');
    const along = new THREE.Vector3(1, 0, 0).applyQuaternion(g.orientation);
    expect(Math.atan2(along.y, along.x)).toBeCloseTo(Math.PI / 4, 6);
  });

  it('turn with a tilted object only about Z while moving, so the Z arrow stays upright', () => {
    const g = gizmo();
    g.attach(new THREE.Vector3(), tilted, 'all');
    const up = new THREE.Vector3(0, 0, 1).applyQuaternion(g.orientation);
    expect(up.z).toBeCloseTo(1, 6);
    const heading = new THREE.Vector3(1, 0, 0).applyQuaternion(g.orientation);
    expect(Math.atan2(heading.y, heading.x)).toBeCloseTo(0.8, 6);
  });

  it('turn every way with it while rotating', () => {
    const g = gizmo();
    g.attach(new THREE.Vector3(), tilted, 'all');
    g.setMode('rotate');
    expect(g.orientation.angleTo(tilted)).toBeCloseTo(0, 6);
    g.setMode('move');
    expect(new THREE.Vector3(0, 0, 1).applyQuaternion(g.orientation).z).toBeCloseTo(1, 6);
  });

  it('stay along the world for a group, which has no single heading', () => {
    const g = gizmo();
    g.attach(new THREE.Vector3(), new THREE.Quaternion(), 'z');
    expect(g.orientation.angleTo(new THREE.Quaternion())).toBeCloseTo(0, 6);
  });
});
