// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Gizmo } from '../../src/renderer/world3d/scene/edit/Gizmo';

/** A flat square of drawn surface at a height */
function floorAt(z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.position.z = z;
  mesh.updateMatrixWorld(true);
  return mesh;
}

function gizmoOver(surfaces: THREE.Object3D[]): Gizmo {
  const events = { started: () => {}, moved: () => {}, ended: () => {} };
  return new Gizmo(new THREE.PerspectiveCamera(), document.createElement('div'), new THREE.Scene(), () => surfaces, events);
}

describe('Gizmo ground under a point', () => {
  it('stays on the floor a point stands on inside a building, not the roof above it', () => {
    const gizmo = gizmoOver([floorAt(20.4), floorAt(35)]);
    expect(gizmo.groundAt(0, 0, 20.4)).toBeCloseTo(20.4);
  });

  it('follows a hill that rises above the point', () => {
    const gizmo = gizmoOver([floorAt(24)]);
    expect(gizmo.groundAt(0, 0, 20)).toBeCloseTo(24);
  });

  it('finds the upper floor of a building when the point is on it', () => {
    const gizmo = gizmoOver([floorAt(20.4), floorAt(35)]);
    expect(gizmo.groundAt(0, 0, 35)).toBeCloseTo(35);
  });

  it('is null over nothing', () => {
    expect(gizmoOver([floorAt(20)]).groundAt(500, 500, 20)).toBeNull();
  });
});
